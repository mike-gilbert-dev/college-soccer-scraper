-- Add a human-readable label to seasons so we can support multi-year seasons
-- like "2026-2027" while keeping the existing year integer for legacy data.

ALTER TABLE seasons ADD COLUMN label text;
UPDATE seasons SET label = year::text;
ALTER TABLE seasons ALTER COLUMN label SET NOT NULL;
ALTER TABLE seasons ADD CONSTRAINT seasons_label_unique UNIQUE (label);

-- Update get_dates_missing_player_stats to accept season_id (bigint)
-- instead of season_year (integer) so it works with any season label.
DROP FUNCTION IF EXISTS get_dates_missing_player_stats(text, integer, integer);

CREATE OR REPLACE FUNCTION get_dates_missing_player_stats(
  p_sport_code  text,
  p_division    integer,
  p_season_id   bigint
)
RETURNS TABLE (contest_date date, game_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT g.contest_date, COUNT(*) AS game_count
  FROM games g
  WHERE g.status    = 'final'
    AND g.sport_code = p_sport_code
    AND g.division   = p_division
    AND g.season_id  = p_season_id
    AND NOT EXISTS (
      SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.id
    )
  GROUP BY g.contest_date
  ORDER BY g.contest_date;
$$;

GRANT EXECUTE ON FUNCTION get_dates_missing_player_stats(text, integer, bigint) TO service_role;
