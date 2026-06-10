-- Fix team_seasons unique constraint to include sport_code so MSO and WSO
-- teams can have separate records for the same season.

-- 1. Drop the old constraint
ALTER TABLE team_seasons DROP CONSTRAINT team_seasons_team_id_season_id_key;

-- 2. Add the new constraint
ALTER TABLE team_seasons ADD CONSTRAINT team_seasons_team_id_season_id_sport_code_key
  UNIQUE (team_id, season_id, sport_code);
