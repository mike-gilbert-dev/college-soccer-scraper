-- ============================================================
-- Pick'em leaderboards.
--
-- SECURITY DEFINER functions rather than views, for three reasons: they need
-- parameters (season, sport, board, qualifier), they need explicit
-- limit/offset (PostgREST caps responses at 1000 rows and truncates SILENTLY),
-- and functions don't trip Supabase's "view is SECURITY DEFINER" advisor lint.
--
-- They expose ONLY aggregates. No individual pick is ever returned here.
--
-- Joining public_profiles means users who haven't confirmed a generated
-- username are excluded automatically — an email-derived name must never
-- surface on a public leaderboard.
-- ============================================================

-- ── Leaderboard ──────────────────────────────────────────────
-- p_board: 'wins' ranks by raw win count with no minimum.
--          'pct'  ranks by win %, requiring p_min_picks graded picks.
--
-- The qualifier is a PARAMETER, not a constant, so it can be retuned without a
-- migration. 25 is a starting guess — revisit once there's real usage.
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_season_id  bigint,
  p_sport_code text,
  p_board      text DEFAULT 'wins',
  p_min_picks  int  DEFAULT 25,
  p_limit      int  DEFAULT 50,
  p_offset     int  DEFAULT 0
)
RETURNS TABLE (
  rank     int,
  user_id  uuid,
  username text,
  wins     int,
  losses   int,
  voids    int,
  graded   int,
  win_pct  numeric
)
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  WITH totals AS (
    SELECT p.user_id,
           pp.username,
           count(*) FILTER (WHERE p.result = 'win')::int  AS w,
           count(*) FILTER (WHERE p.result = 'loss')::int AS l,
           count(*) FILTER (WHERE p.result = 'void')::int AS v,
           count(*)::int                                  AS g
      FROM public.picks p
      JOIN public.public_profiles pp ON pp.id = p.user_id
     WHERE p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IS NOT NULL
     GROUP BY p.user_id, pp.username
  ),
  eligible AS (
    SELECT *,
           CASE WHEN (w + l) > 0 THEN round(w::numeric / (w + l), 4) END AS pct
      FROM totals
     WHERE p_board <> 'pct'
        -- The qualifier counts DECIDED picks (w + l), not graded-including-voids.
        -- Voids are non-events: someone with 25 cancelled games and one real pick
        -- must not qualify for a percentage board on a one-game sample. This also
        -- drops all-void users, who have no percentage and must not sort as 0%.
        OR (w + l) >= p_min_picks
  )
  -- rank(), not row_number(): identical records must share a rank rather than
  -- being ordered arbitrarily. Ties are common with few users.
  SELECT rank() OVER (
           ORDER BY CASE WHEN p_board = 'pct' THEN pct END DESC NULLS LAST,
                    CASE WHEN p_board = 'pct' THEN NULL ELSE w END DESC
         )::int,
         user_id, username, w, l, v, g, pct
    FROM eligible
   ORDER BY CASE WHEN p_board = 'pct' THEN pct END DESC NULLS LAST,
            CASE WHEN p_board = 'pct' THEN NULL ELSE w END DESC,
            username
   LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
$$;

-- ── Where do I stand? ────────────────────────────────────────
-- Lets an unqualified user still see their own position and how far they are
-- from qualifying — the reason two boards beat one.
CREATE OR REPLACE FUNCTION public.get_user_leaderboard_position(
  p_username   text,
  p_season_id  bigint,
  p_sport_code text,
  p_board      text DEFAULT 'wins',
  p_min_picks  int  DEFAULT 25
)
RETURNS TABLE (
  rank            int,
  wins            int,
  losses          int,
  graded          int,
  win_pct         numeric,
  qualified       boolean,
  picks_needed    int,
  total_ranked    int
)
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  WITH totals AS (
    SELECT p.user_id,
           pp.username,
           count(*) FILTER (WHERE p.result = 'win')::int  AS w,
           count(*) FILTER (WHERE p.result = 'loss')::int AS l,
           count(*)::int                                  AS g
      FROM public.picks p
      JOIN public.public_profiles pp ON pp.id = p.user_id
     WHERE p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IS NOT NULL
     GROUP BY p.user_id, pp.username
  ),
  eligible AS (
    SELECT *, CASE WHEN (w + l) > 0 THEN round(w::numeric / (w + l), 4) END AS pct
      FROM totals
     WHERE p_board <> 'pct' OR (w + l) >= p_min_picks
  ),
  ranked AS (
    SELECT username, w, l, g, pct,
           rank() OVER (
             ORDER BY CASE WHEN p_board = 'pct' THEN pct END DESC NULLS LAST,
                      CASE WHEN p_board = 'pct' THEN NULL ELSE w END DESC
           )::int AS rnk
      FROM eligible
  ),
  me AS (
    SELECT * FROM totals WHERE lower(username) = lower(p_username)
  )
  SELECT (SELECT rnk FROM ranked WHERE lower(username) = lower(p_username)),
         me.w,
         me.l,
         me.g,
         CASE WHEN (me.w + me.l) > 0 THEN round(me.w::numeric / (me.w + me.l), 4) END,
         (p_board <> 'pct') OR (me.w + me.l) >= p_min_picks,
         greatest(0, p_min_picks - (me.w + me.l)),
         (SELECT count(*)::int FROM ranked)
    FROM me;
$$;

-- ── Permissions ──────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_leaderboard(bigint, text, text, int, int, int)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_leaderboard_position(text, bigint, text, text, int) TO anon, authenticated;
