-- Returns dates that have at least one final game with no player_game_stats rows.
-- Used by the admin "Missing Stats" tab to identify backfill gaps.
CREATE OR REPLACE FUNCTION get_dates_missing_player_stats(
  p_sport_code  text,
  p_division    integer,
  p_season_year integer
)
RETURNS TABLE (contest_date date, game_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT g.contest_date, COUNT(*) AS game_count
  FROM games g
  JOIN seasons s ON s.id = g.season_id
  WHERE g.status = 'final'
    AND g.sport_code = p_sport_code
    AND g.division   = p_division
    AND s.year       = p_season_year
    AND NOT EXISTS (
      SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.id
    )
  GROUP BY g.contest_date
  ORDER BY g.contest_date;
$$;

GRANT EXECUTE ON FUNCTION get_dates_missing_player_stats(text, integer, integer) TO service_role;
