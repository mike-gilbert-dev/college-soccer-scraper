-- ============================================================
-- Pick'em: picks table, kickoff lock, and RLS.
--
-- A pick stores an OUTCOME ('home' | 'draw' | 'away'), never a team id. Two
-- reasons: it makes 2-way vs 3-way picking a config difference rather than a
-- migration, and it avoids depending on team_seasons.id, which
-- 20260609000001_split_team_seasons_by_sport.sql has already rewritten once.
--
-- 3-way picking is deliberate: 2025 D1 finals were 22.3% draws (MSO) and 21.5%
-- (WSO) — 1,149 of 5,276 games. Treating draws as a push would void roughly one
-- pick in five.
--
-- The kickoff lock is enforced HERE, in RLS, not in the UI. A lock that only
-- exists in the client is not a lock.
-- ============================================================

CREATE TYPE public.pick_outcome AS ENUM ('home', 'draw', 'away');
CREATE TYPE public.pick_result  AS ENUM ('win', 'loss', 'void');

CREATE TABLE public.picks (
  id         bigserial           PRIMARY KEY,
  user_id    uuid                NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  game_id    bigint              NOT NULL REFERENCES public.games (id) ON DELETE CASCADE,
  outcome    public.pick_outcome NOT NULL,

  -- Denormalized from games by trigger; the client never supplies these, so it
  -- cannot mis-attribute a pick to the wrong season, sport or division.
  season_id  bigint              NOT NULL REFERENCES public.seasons (id),
  sport_code text                NOT NULL,
  division   smallint            NOT NULL,

  result     public.pick_result,          -- null = not yet graded
  graded_at  timestamptz,

  created_at timestamptz         NOT NULL DEFAULT now(),
  updated_at timestamptz         NOT NULL DEFAULT now(),

  UNIQUE (user_id, game_id)
);

COMMENT ON TABLE public.picks IS
  'One prediction per user per game. Outcome is home/draw/away; a shootout counts as a draw, matching how the rest of the site treats PK games.';
COMMENT ON COLUMN public.picks.division IS
  'Denormalized from games.division so leaderboards can be scoped per division. Only D1 is ingested today, but /scores accepts a ?division= param.';
COMMENT ON COLUMN public.picks.result IS
  'Null until graded. Written by grade_picks(); void = game cancelled.';

CREATE INDEX picks_user_season_idx ON public.picks (user_id, season_id, sport_code, division);
CREATE INDEX picks_game_idx        ON public.picks (game_id);
-- Drives the grader: only ungraded rows are candidates.
CREATE INDEX picks_ungraded_idx    ON public.picks (game_id) WHERE result IS NULL;

-- ── Denormalization trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.picks_fill_game_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  SELECT g.season_id, g.sport_code, g.division
    INTO new.season_id, new.sport_code, new.division
    FROM public.games g
   WHERE g.id = new.game_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game % does not exist', new.game_id;
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER picks_fill_game_context_trg
  BEFORE INSERT OR UPDATE OF game_id ON public.picks
  FOR EACH ROW EXECUTE FUNCTION public.picks_fill_game_context();

CREATE OR REPLACE FUNCTION public.set_picks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER picks_set_updated_at
  BEFORE UPDATE ON public.picks
  FOR EACH ROW EXECUTE FUNCTION public.set_picks_updated_at();

-- ── The kickoff lock ─────────────────────────────────────────
-- SECURITY DEFINER because it is called from RLS policies and must read games
-- regardless of who is asking.
--
-- The coalesce fallback is a safety net, not a hot path: 0 of 5,279 D1 2025
-- games had a null start_time. It locks a TBD-time game at midnight ET on game
-- day, which errs toward locking early — the right direction for integrity.
CREATE OR REPLACE FUNCTION public.game_is_open(p_game_id bigint)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.games g
     WHERE g.id = p_game_id
       AND g.status = 'scheduled'
       AND coalesce(g.start_time,
                    (g.contest_date::timestamp AT TIME ZONE 'America/New_York')) > now()
  );
$$;

-- ── Permissions + RLS ────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.picks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.picks_id_seq TO authenticated;
GRANT ALL ON TABLE public.picks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.picks_id_seq TO service_role;

ALTER TABLE public.picks ENABLE ROW LEVEL SECURITY;

-- Users can only ever SELECT their own picks. Aggregate visibility
-- (leaderboards, other users' profiles) arrives later via SECURITY DEFINER
-- functions that expose totals only.
CREATE POLICY "read own picks" ON public.picks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "insert own picks" ON public.picks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.game_is_open(game_id));

CREATE POLICY "update own picks" ON public.picks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.game_is_open(game_id))
  WITH CHECK (auth.uid() = user_id AND public.game_is_open(game_id));

CREATE POLICY "delete own picks" ON public.picks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.game_is_open(game_id));

-- game_is_open is called from policies (as the owner) and by the app to decide
-- whether to render a pick control.
GRANT EXECUTE ON FUNCTION public.game_is_open(bigint) TO anon, authenticated;

-- Internal helpers — Postgres grants EXECUTE to PUBLIC by default.
REVOKE ALL ON FUNCTION public.picks_fill_game_context() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_picks_updated_at()    FROM PUBLIC, anon, authenticated;
