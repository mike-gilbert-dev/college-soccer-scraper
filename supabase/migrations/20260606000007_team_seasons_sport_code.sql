-- Add sport_code to team_seasons so the teams list page can filter by
-- sport (MSO/WSO) without joining through the games table.
ALTER TABLE team_seasons
  ADD COLUMN sport_code text NOT NULL DEFAULT 'MSO';

-- Backfill from games — each team_season's sport is inferred from
-- the games it appears in (home or away side).
UPDATE team_seasons ts
SET sport_code = g.sport_code
FROM (
  SELECT DISTINCT ON (team_season_id) team_season_id, sport_code
  FROM (
    SELECT home_team_season_id AS team_season_id, sport_code FROM games
    UNION ALL
    SELECT away_team_season_id AS team_season_id, sport_code FROM games
  ) combined
  ORDER BY team_season_id
) g
WHERE g.team_season_id = ts.id;
