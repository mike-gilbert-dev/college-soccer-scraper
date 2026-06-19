-- ============================================================
-- Division membership flag for team_seasons
-- ------------------------------------------------------------
-- The NCAA per-division contest feed includes non-division opponents
-- (exhibitions, D2/D3 crossovers). Ingest stamps every opponent with the
-- scraped division, so non-D1 teams leak into D1 standings and ratings, almost
-- always with only 1-2 games. conferences.division is polluted the same way and
-- can't be trusted, so membership is derived from play: the conferences that
-- field full-schedule teams ARE the division's real conferences.
-- ============================================================

ALTER TABLE team_seasons
  ADD COLUMN division_member boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------
-- refresh_division_members
-- Recompute the flag for one (sport, division, season) scope. A team is a
-- member iff its conference is one used by a full-schedule team (>= p_min_games
-- final games) in the scope. No conference -> not a member.
-- Defaults to true everywhere until this runs, so it is non-destructive.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_division_members(
  p_sport_code text,
  p_division   smallint,
  p_season_id  bigint,
  p_min_games  integer DEFAULT 5
)
RETURNS TABLE (members bigint, non_members bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  WITH gc AS (
    SELECT ts.id, ts.conference_id,
      count(g.id) FILTER (
        WHERE g.status = 'final' AND g.sport_code = p_sport_code
          AND g.division = p_division AND g.season_id = p_season_id
          AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      ) AS games
    FROM team_seasons ts
    LEFT JOIN games g
      ON (g.home_team_season_id = ts.id OR g.away_team_season_id = ts.id)
    WHERE ts.season_id = p_season_id
      AND ts.sport_code = p_sport_code
      AND ts.division = p_division
    GROUP BY ts.id, ts.conference_id
  ),
  allow AS (
    SELECT DISTINCT conference_id
    FROM gc
    WHERE conference_id IS NOT NULL AND games >= p_min_games
  )
  UPDATE team_seasons ts
  SET division_member = (
    gc.conference_id IS NOT NULL
    AND gc.conference_id IN (SELECT conference_id FROM allow)
  )
  FROM gc
  WHERE ts.id = gc.id;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE ts.division_member),
    count(*) FILTER (WHERE NOT ts.division_member)
  FROM team_seasons ts
  WHERE ts.season_id = p_season_id
    AND ts.sport_code = p_sport_code
    AND ts.division = p_division;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_division_members(text, smallint, bigint, integer)
  TO service_role;

-- ------------------------------------------------------------
-- get_standings (replace): member teams only, and only count games whose
-- opponent is also a member (non-D1 games are excluded from the record).
-- ------------------------------------------------------------
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
      WHEN opp.id IS NOT NULL AND g.home_team_season_id = ts.id AND g.home_score > g.away_score THEN 1
      WHEN opp.id IS NOT NULL AND g.away_team_season_id = ts.id AND g.away_score > g.home_score THEN 1
    END) AS wins,
    COUNT(CASE
      WHEN opp.id IS NOT NULL AND g.home_team_season_id = ts.id AND g.home_score < g.away_score THEN 1
      WHEN opp.id IS NOT NULL AND g.away_team_season_id = ts.id AND g.away_score < g.home_score THEN 1
    END) AS losses,
    COUNT(CASE
      WHEN opp.id IS NOT NULL
       AND (g.home_team_season_id = ts.id OR g.away_team_season_id = ts.id)
       AND g.home_score = g.away_score THEN 1
    END) AS ties,
    COALESCE(SUM(CASE
      WHEN opp.id IS NOT NULL AND g.home_team_season_id = ts.id THEN g.home_score
      WHEN opp.id IS NOT NULL AND g.away_team_season_id = ts.id THEN g.away_score
    END), 0) AS goals_for,
    COALESCE(SUM(CASE
      WHEN opp.id IS NOT NULL AND g.home_team_season_id = ts.id THEN g.away_score
      WHEN opp.id IS NOT NULL AND g.away_team_season_id = ts.id THEN g.home_score
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
  LEFT JOIN team_seasons opp
    ON opp.id = CASE
         WHEN g.home_team_season_id = ts.id THEN g.away_team_season_id
         ELSE g.home_team_season_id
       END
   AND opp.division_member
  WHERE ts.season_id  = p_season_id
    AND ts.sport_code = p_sport_code
    AND ts.division   = p_division
    AND ts.division_member
  GROUP BY ts.id;
$$;

-- ------------------------------------------------------------
-- get_current_ratings (replace): member teams only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_ratings(
  p_season_id  bigint,
  p_sport_code text,
  p_division   smallint,
  p_system     text
)
RETURNS TABLE (
  ts_id        bigint,
  value        double precision,
  rank         integer,
  games_played integer,
  as_of        date
)
LANGUAGE sql
STABLE
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (tr.team_season_id)
      tr.team_season_id, tr.value, tr.games_played, tr.as_of
    FROM team_ratings tr
    JOIN team_seasons ts ON ts.id = tr.team_season_id
    WHERE ts.season_id  = p_season_id
      AND ts.sport_code = p_sport_code
      AND ts.division   = p_division
      AND ts.division_member
      AND tr.system     = p_system
    ORDER BY tr.team_season_id, tr.as_of DESC
  )
  SELECT
    team_season_id AS ts_id,
    value,
    RANK() OVER (ORDER BY value DESC)::int AS rank,
    games_played,
    as_of
  FROM latest;
$$;
