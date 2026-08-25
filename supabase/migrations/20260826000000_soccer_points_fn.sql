-- Single source of truth for NCAA soccer scoring: points = (goals * 2) + assists.
-- Confirmed via NCAA.com and the NCAA soccer statisticians' manual -- the
-- player_season_stats view previously computed points as plain goals + assists,
-- silently undercounting every player's season total. soccer_points() is now the
-- only place this formula is defined; both season totals (below) and per-game
-- series callers (player_game_stats_points()) derive from it.
CREATE FUNCTION soccer_points(p_goals bigint, p_assists bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_goals * 2 + p_assists
$$;

-- PostgREST "computed column": callable from a `.select()` as an ordinary column
-- on player_game_stats, so per-game points never has to be recomputed client-side.
CREATE FUNCTION player_game_stats_points(pgs player_game_stats)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT soccer_points(pgs.goals, pgs.assists)
$$;

GRANT EXECUTE ON FUNCTION soccer_points(bigint, bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION player_game_stats_points(player_game_stats) TO anon, authenticated, service_role;

-- Fix the view's points column to use the corrected formula. CREATE OR REPLACE VIEW
-- requires existing columns to keep their name/position/type unchanged (see
-- 20260623000000_player_season_stats_headshot.sql) -- points stays `bigint`.
CREATE OR REPLACE VIEW player_season_stats AS
SELECT
  ps.id                AS player_season_id,
  ps.player_id,
  p.ncaa_player_id,
  p.name               AS player_name,
  ps.team_season_id,
  ps.jersey_number,
  ps.position,
  ps.class_year,
  COUNT(DISTINCT pgs.game_id)                           AS games_played,
  COALESCE(SUM(pgs.minutes_played),       0)            AS minutes_played,
  COALESCE(SUM(pgs.goals),                0)            AS goals,
  COALESCE(SUM(pgs.assists),              0)            AS assists,
  soccer_points(COALESCE(SUM(pgs.goals), 0), COALESCE(SUM(pgs.assists), 0)) AS points,
  COALESCE(SUM(pgs.shots),                0)            AS shots,
  COALESCE(SUM(pgs.shots_on_goal),        0)            AS shots_on_goal,
  COALESCE(SUM(pgs.fouls_committed),      0)            AS fouls,
  COALESCE(SUM(pgs.yellow_cards),         0)            AS yellow_cards,
  COALESCE(SUM(pgs.red_cards),            0)            AS red_cards,
  COALESCE(SUM(pgs.green_cards),          0)            AS green_cards,
  COALESCE(SUM(pgs.penalty_shot_goals),   0)            AS penalty_shot_goals,
  COALESCE(SUM(pgs.penalty_shot_attempts), 0)           AS penalty_shot_attempts,
  SUM(pgs.gk_saves)                                     AS gk_saves,
  SUM(pgs.gk_goals_against)                             AS gk_goals_against,
  COALESCE(SUM(CASE WHEN pgs.gk_shutout THEN 1 ELSE 0 END), 0) AS gk_shutouts,
  ps.headshot_path
FROM player_seasons ps
JOIN players p ON p.id = ps.player_id
LEFT JOIN player_game_stats pgs ON pgs.player_season_id = ps.id
GROUP BY
  ps.id, ps.player_id, p.ncaa_player_id, p.name,
  ps.team_season_id, ps.jersey_number, ps.position, ps.class_year, ps.headshot_path;
