CREATE OR REPLACE FUNCTION get_games_missing_player_stats(
  p_sport_code text,
  p_division   integer,
  p_season_id  bigint
)
RETURNS TABLE (
  ncaa_contest_id text,
  contest_date    date,
  home_team       text,
  away_team       text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    g.ncaa_contest_id,
    g.contest_date,
    ht.name AS home_team,
    at.name AS away_team
  FROM games g
  JOIN team_seasons hts ON hts.id = g.home_team_season_id
  JOIN teams ht          ON ht.id  = hts.team_id
  JOIN team_seasons ats ON ats.id = g.away_team_season_id
  JOIN teams at          ON at.id  = ats.team_id
  WHERE g.season_id  = p_season_id
    AND g.sport_code = p_sport_code
    AND g.division   = p_division
    AND g.status     = 'final'
    AND NOT EXISTS (
      SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.id
    )
  ORDER BY g.contest_date DESC;
$$;

GRANT EXECUTE ON FUNCTION get_games_missing_player_stats(text, integer, bigint) TO service_role;
