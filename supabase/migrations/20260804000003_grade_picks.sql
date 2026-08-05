-- ============================================================
-- Pick'em grading.
--
-- Sets picks.result from the current state of the game. Rules:
--   final + scores  -> 'win' | 'loss'
--   cancelled       -> 'void'
--   postponed       -> ungraded (the row keeps its id and grades once played)
--   scheduled/live  -> ungraded
--
-- A SHOOTOUT IS A DRAW. A PK-decided game keeps its tied score, and the site
-- already treats it as a tie in W-L-T records, Elo and RPI (see
-- 20260723000000_games_shootout.sql). shootout_winner_team_season_id is
-- deliberately not consulted — grading it any other way would contradict every
-- other page on the site.
--
-- IDEMPOTENT: the `result is distinct from` guard means a re-run changes nothing
-- unless a game actually changed. That is also how a corrected score self-heals,
-- and why this is safe to run on a schedule forever.
--
-- Mirrored in TypeScript by actualOutcome()/gradePick() in src/lib/picks.ts,
-- which exists only for instant UI feedback. This function is authoritative.
-- ============================================================

CREATE OR REPLACE FUNCTION public.grade_picks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH computed AS (
    SELECT p.id,
           CASE
             WHEN g.status = 'cancelled' THEN 'void'::public.pick_result
             WHEN g.status = 'final'
                  AND g.home_score IS NOT NULL
                  AND g.away_score IS NOT NULL
             THEN CASE
                    WHEN (CASE
                            WHEN g.home_score > g.away_score THEN 'home'
                            WHEN g.away_score > g.home_score THEN 'away'
                            ELSE 'draw'
                          END)::public.pick_outcome = p.outcome
                    THEN 'win'::public.pick_result
                    ELSE 'loss'::public.pick_result
                  END
             ELSE NULL
           END AS new_result
      FROM public.picks p
      JOIN public.games g ON g.id = p.game_id
  )
  UPDATE public.picks p
     SET result    = c.new_result,
         graded_at = CASE WHEN c.new_result IS NULL THEN NULL ELSE now() END
    FROM computed c
   WHERE c.id = p.id
     AND p.result IS DISTINCT FROM c.new_result;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.grade_picks() IS
  'Grades every pick against its game. Idempotent — returns the number of rows actually changed. Shootouts grade as draws, matching the rest of the site.';

-- Internal only: this is driven by cron, never by a client.
REVOKE ALL ON FUNCTION public.grade_picks() FROM PUBLIC, anon, authenticated;

-- ── Schedule ─────────────────────────────────────────────────
-- Pure SQL, so no edge function, no HTTP, no Vault secret — unlike the ingest
-- pipeline. Every 10 minutes self-gates to zero work when nothing has changed,
-- so picks resolve minutes after a final rather than waiting for the 08:00 UTC
-- nightly chain.
SELECT cron.schedule('grade-picks', '*/10 * * * *', $$SELECT public.grade_picks()$$);
