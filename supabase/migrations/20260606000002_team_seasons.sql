-- ============================================================
-- Add team_seasons: links teams to seasons with season-specific
-- conference and division data.
-- Games now reference team_seasons instead of teams directly,
-- so every game is unambiguously tied to a team-in-a-season.
-- ============================================================

-- 1. team_seasons junction table
--    Upsert key: (team_id, season_id) — one row per team per season.
--    conference_id is nullable — populated separately from a
--    conference-roster scrape; the game response only gives us the
--    conference slug, not the full name required by the conferences table.
CREATE TABLE team_seasons (
  id             bigserial PRIMARY KEY,
  team_id        bigint   NOT NULL REFERENCES teams (id),
  season_id      bigint   NOT NULL REFERENCES seasons (id),
  conference_id  bigint   REFERENCES conferences (id),
  division       smallint NOT NULL CHECK (division BETWEEN 1 AND 3),
  UNIQUE (team_id, season_id)
);

CREATE INDEX team_seasons_team_id_idx   ON team_seasons (team_id);
CREATE INDEX team_seasons_season_id_idx ON team_seasons (season_id);

-- 2. Backfill team_seasons from existing games before we migrate the FKs.
--    UNION deduplicates; ON CONFLICT handles any remaining dups.
INSERT INTO team_seasons (team_id, season_id, division)
SELECT home_team_id, season_id, division FROM games
UNION
SELECT away_team_id, season_id, division FROM games
ON CONFLICT (team_id, season_id) DO NOTHING;

-- 3. Add new FK columns to games (nullable until step 4 populates them)
ALTER TABLE games
  ADD COLUMN home_team_season_id bigint REFERENCES team_seasons (id),
  ADD COLUMN away_team_season_id bigint REFERENCES team_seasons (id);

-- 4. Populate new columns by joining through the team_seasons we just created.
--    Both tables listed in FROM with all join conditions in WHERE —
--    PostgreSQL disallows referencing the target table alias inside JOIN ... ON.
UPDATE games g
SET
  home_team_season_id = ts_h.id,
  away_team_season_id = ts_a.id
FROM team_seasons ts_h, team_seasons ts_a
WHERE ts_h.team_id = g.home_team_id AND ts_h.season_id = g.season_id
  AND ts_a.team_id = g.away_team_id AND ts_a.season_id = g.season_id;

-- 5. Enforce NOT NULL now that every row has been matched
ALTER TABLE games
  ALTER COLUMN home_team_season_id SET NOT NULL,
  ALTER COLUMN away_team_season_id SET NOT NULL;

-- 6. Drop stale indexes that reference columns we're about to remove
DROP INDEX IF EXISTS games_home_team_idx;
DROP INDEX IF EXISTS games_away_team_idx;
DROP INDEX IF EXISTS games_conference_idx;

-- 7. Remove columns that are now superseded by team_seasons FKs.
--    division was authoritative per-game; it's now on team_seasons.
--    conference_id per-game is replaced by each team's team_seasons.conference_id.
ALTER TABLE games
  DROP COLUMN home_team_id,
  DROP COLUMN away_team_id,
  DROP COLUMN conference_id,
  DROP COLUMN division;

-- 8. Division is now season-specific; remove from the teams master record.
ALTER TABLE teams DROP COLUMN division;

-- 9. Indexes for game lookups via team_seasons
CREATE INDEX games_home_team_season_idx ON games (home_team_season_id);
CREATE INDEX games_away_team_season_idx ON games (away_team_season_id);

-- 10. Permissions
GRANT ALL ON TABLE team_seasons TO service_role;
GRANT USAGE, SELECT ON SEQUENCE team_seasons_id_seq TO service_role;
ALTER TABLE team_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read team_seasons" ON team_seasons FOR SELECT USING (true);
