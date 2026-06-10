-- Fix data that was scraped before the sport_code uniqueness constraint:
-- team_seasons rows that accumulated games from multiple sports get split
-- into one row per sport, and game FKs are remapped accordingly.
-- Player stats are cleared and must be re-scraped into the correct rows.

-- 1. Create sport-specific team_season rows and remap game FKs.
DO $$
DECLARE
  r      RECORD;
  new_id bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT
      ts.id            AS ts_id,
      ts.team_id,
      ts.season_id,
      ts.division,
      ts.conference_id,
      g.sport_code     AS game_sport
    FROM team_seasons ts
    JOIN LATERAL (
      SELECT DISTINCT sport_code
      FROM games
      WHERE (home_team_season_id = ts.id OR away_team_season_id = ts.id)
        AND sport_code <> ts.sport_code
    ) g ON true
  LOOP
    INSERT INTO team_seasons (team_id, season_id, division, conference_id, sport_code)
    VALUES (r.team_id, r.season_id, r.division, r.conference_id, r.game_sport)
    ON CONFLICT (team_id, season_id, sport_code) DO NOTHING;

    SELECT id INTO new_id
    FROM team_seasons
    WHERE team_id   = r.team_id
      AND season_id = r.season_id
      AND sport_code = r.game_sport;

    UPDATE games SET home_team_season_id = new_id
    WHERE home_team_season_id = r.ts_id AND sport_code = r.game_sport;

    UPDATE games SET away_team_season_id = new_id
    WHERE away_team_season_id = r.ts_id AND sport_code = r.game_sport;
  END LOOP;
END $$;

-- 2. Clear player stats — all player_seasons reference a team_season_id that
--    may now be the wrong sport. Re-run the backfill with "Include player stats"
--    to repopulate them under the correct sport-specific team_season.
DELETE FROM player_game_stats;
DELETE FROM player_seasons;
