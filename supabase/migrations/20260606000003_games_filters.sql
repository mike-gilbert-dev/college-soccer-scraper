-- ============================================================
-- Add sport_code and division to games for scoreboard filtering.
-- sport_code follows the NCAA API pattern: MSO / WSO.
-- division is denormalized from team_seasons so the scoreboard
-- query doesn't need an extra join on every page load.
-- ============================================================

ALTER TABLE games
  ADD COLUMN sport_code text NOT NULL DEFAULT 'MSO'
    CHECK (sport_code IN ('MSO', 'WSO')),
  ADD COLUMN division smallint NOT NULL DEFAULT 1
    CHECK (division BETWEEN 1 AND 3);

-- Backfill division from the home team's team_season
UPDATE games g
SET division = ts.division
FROM team_seasons ts
WHERE ts.id = g.home_team_season_id;

-- Primary index for the scoreboard query: sport + division + date + season
CREATE INDEX games_scoreboard_idx
  ON games (sport_code, division, contest_date, season_id);
