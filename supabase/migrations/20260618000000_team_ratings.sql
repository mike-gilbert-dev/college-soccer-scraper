-- ============================================================
-- Team Ratings — unified ratings table + current-ratings reader
-- ------------------------------------------------------------
-- A rating is a pure, reproducible function of the games table.
-- One row per (team_season, system, as_of) snapshot:
--   elo   -> as_of is the game's contest_date (full per-game history)
--   rpi   -> as_of is the recompute date (one snapshot per recompute)
--   power -> as_of is the recompute date (one snapshot per recompute)
-- Scope (season / sport / division) is reached via team_seasons,
-- never duplicated here.
-- ============================================================

CREATE TABLE team_ratings (
  id              bigserial PRIMARY KEY,
  team_season_id  bigint NOT NULL REFERENCES team_seasons (id) ON DELETE CASCADE,
  system          text   NOT NULL CHECK (system IN ('elo','rpi','power')),
  as_of           date   NOT NULL,
  value           double precision NOT NULL,
  rank            integer,
  games_played    integer NOT NULL DEFAULT 0,
  meta            jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  -- Makes recompute idempotent: re-running overwrites a snapshot, never duplicates.
  UNIQUE (team_season_id, system, as_of)
);

CREATE INDEX team_ratings_lookup_idx ON team_ratings (team_season_id, system, as_of DESC);
CREATE INDEX team_ratings_system_idx ON team_ratings (system, as_of DESC);

-- ── Permissions (mirror team_seasons convention) ─────────────
GRANT ALL ON TABLE team_ratings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE team_ratings_id_seq TO service_role;
ALTER TABLE team_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read team_ratings" ON team_ratings FOR SELECT USING (true);

-- ------------------------------------------------------------
-- get_current_ratings
-- Latest rating per team_season for a scope + system, ranked.
-- Mirrors get_standings so the app never fetches raw rating rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_ratings(
  p_season_id  bigint,
  p_sport_code text,
  p_division   smallint,
  p_system     text
)
RETURNS TABLE (
  ts_id        bigint,
  value        double precision,
  rank         integer,
  games_played integer,
  as_of        date
)
LANGUAGE sql
STABLE
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (tr.team_season_id)
      tr.team_season_id, tr.value, tr.games_played, tr.as_of
    FROM team_ratings tr
    JOIN team_seasons ts ON ts.id = tr.team_season_id
    WHERE ts.season_id  = p_season_id
      AND ts.sport_code = p_sport_code
      AND ts.division   = p_division
      AND tr.system     = p_system
    ORDER BY tr.team_season_id, tr.as_of DESC
  )
  SELECT
    team_season_id AS ts_id,
    value,
    RANK() OVER (ORDER BY value DESC)::int AS rank,
    games_played,
    as_of
  FROM latest;
$$;

GRANT EXECUTE ON FUNCTION get_current_ratings(bigint, text, smallint, text)
  TO anon, authenticated, service_role;
