-- Compute standings (W-L-T, GF, GA) per team_season in the database so the
-- application never has to fetch all game rows across a full season.
-- Replaces the in-memory accumulator in teams/+page.server.ts.

CREATE OR REPLACE FUNCTION get_standings(
  p_season_id  bigint,
  p_sport_code text,
  p_division   smallint
)
RETURNS TABLE (
  ts_id         bigint,
  wins          bigint,
  losses        bigint,
  ties          bigint,
  goals_for     bigint,
  goals_against bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ts.id AS ts_id,
    COUNT(CASE
      WHEN g.home_team_season_id = ts.id AND g.home_score > g.away_score THEN 1
      WHEN g.away_team_season_id = ts.id AND g.away_score > g.home_score THEN 1
    END) AS wins,
    COUNT(CASE
      WHEN g.home_team_season_id = ts.id AND g.home_score < g.away_score THEN 1
      WHEN g.away_team_season_id = ts.id AND g.away_score < g.home_score THEN 1
    END) AS losses,
    COUNT(CASE
      WHEN (g.home_team_season_id = ts.id OR g.away_team_season_id = ts.id)
       AND g.home_score = g.away_score THEN 1
    END) AS ties,
    COALESCE(SUM(CASE
      WHEN g.home_team_season_id = ts.id THEN g.home_score
      WHEN g.away_team_season_id = ts.id THEN g.away_score
    END), 0) AS goals_for,
    COALESCE(SUM(CASE
      WHEN g.home_team_season_id = ts.id THEN g.away_score
      WHEN g.away_team_season_id = ts.id THEN g.home_score
    END), 0) AS goals_against
  FROM team_seasons ts
  LEFT JOIN games g
    ON  (g.home_team_season_id = ts.id OR g.away_team_season_id = ts.id)
    AND g.status      = 'final'
    AND g.sport_code  = p_sport_code
    AND g.division    = p_division
    AND g.season_id   = p_season_id
    AND g.home_score IS NOT NULL
    AND g.away_score IS NOT NULL
  WHERE ts.season_id  = p_season_id
    AND ts.sport_code = p_sport_code
    AND ts.division   = p_division
  GROUP BY ts.id;
$$;

GRANT EXECUTE ON FUNCTION get_standings(bigint, text, smallint) TO anon, authenticated, service_role;
