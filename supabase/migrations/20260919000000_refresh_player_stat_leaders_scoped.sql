-- refresh_player_stat_leaders() has been hitting the statement timeout on every
-- nightly-reconcile run since 2026-08-26, leaving team_season_stat_totals,
-- player_season_stat_leaders and player_season_stat_category_averages frozen at
-- their 2026-08-25 backfill. /stats rendered a month-old leaderboard, and its
-- trend chart -- which anchors each leader's last point to the cached season
-- total while drawing the rest of the line from live player_game_stats -- showed
-- a cumulative line that fell at the final game.
--
-- Cause: every one of the function's 13 queries read the player_season_stats
-- VIEW, which GROUP BYs all of player_game_stats (635k rows, every season and
-- division) before the season/sport/division filter can be applied. The filter
-- lives on team_seasons, joined outside the view, so Postgres cannot push it
-- into the grouped subquery -- each query re-aggregated the entire league.
--
-- Fix: aggregate once, scoped, into a temp table, then derive the team totals,
-- the six leaderboards and the six field averages from that. The scan now walks
-- only the player_seasons of the in-scope team_seasons (via
-- player_seasons_team_season_idx) and their player_game_stats (via
-- player_game_stats_ps_idx). Output is byte-for-byte what the view-based version
-- produced: the aggregate expressions below mirror the view's columns exactly,
-- points included (public.soccer_points, the single source of that formula).
CREATE OR REPLACE FUNCTION refresh_player_stat_leaders(
  p_season_id  bigint,
  p_sport_code text,
  p_division   integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_category text;
BEGIN
  -- One scoped pass over player_game_stats. ON COMMIT DROP is enough cleanup --
  -- the RPC runs in its own transaction -- but a connection-pooled session can
  -- hand us a leftover from a failed earlier call, so drop defensively first.
  DROP TABLE IF EXISTS pg_temp.rpsl_agg;
  CREATE TEMP TABLE rpsl_agg ON COMMIT DROP AS
  SELECT
    ps.id                                                          AS player_season_id,
    ps.team_season_id,
    COUNT(DISTINCT pgs.game_id)                                    AS games_played,
    COALESCE(SUM(pgs.goals),           0)::bigint                  AS goals,
    COALESCE(SUM(pgs.assists),         0)::bigint                  AS assists,
    public.soccer_points(
      COALESCE(SUM(pgs.goals),   0)::bigint,
      COALESCE(SUM(pgs.assists), 0)::bigint
    )                                                              AS points,
    COALESCE(SUM(pgs.shots),           0)::bigint                  AS shots,
    COALESCE(SUM(pgs.shots_on_goal),   0)::bigint                  AS shots_on_goal,
    COALESCE(SUM(pgs.fouls_committed), 0)::bigint                  AS fouls,
    COALESCE(SUM(pgs.yellow_cards),    0)::bigint                  AS yellow_cards,
    COALESCE(SUM(pgs.red_cards),       0)::bigint                  AS red_cards,
    COALESCE(SUM(pgs.gk_saves),        0)::bigint                  AS gk_saves,
    COALESCE(SUM(CASE WHEN pgs.gk_shutout THEN 1 ELSE 0 END), 0)::bigint AS gk_shutouts
  FROM public.team_seasons ts
  JOIN public.player_seasons ps      ON ps.team_season_id = ts.id
  LEFT JOIN public.player_game_stats pgs ON pgs.player_season_id = ps.id
  WHERE ts.season_id  = p_season_id
    AND ts.sport_code = p_sport_code
    AND ts.division   = p_division
  GROUP BY ps.id, ps.team_season_id;

  INSERT INTO public.team_season_stat_totals
    (team_season_id, shots, shots_on_goal, fouls, yellow_cards, red_cards, computed_at)
  SELECT
    a.team_season_id,
    SUM(a.shots),
    SUM(a.shots_on_goal),
    SUM(a.fouls),
    SUM(a.yellow_cards),
    SUM(a.red_cards),
    now()
  FROM pg_temp.rpsl_agg a
  GROUP BY a.team_season_id
  ON CONFLICT (team_season_id) DO UPDATE SET
    shots         = EXCLUDED.shots,
    shots_on_goal = EXCLUDED.shots_on_goal,
    fouls         = EXCLUDED.fouls,
    yellow_cards  = EXCLUDED.yellow_cards,
    red_cards     = EXCLUDED.red_cards,
    computed_at   = EXCLUDED.computed_at;

  DELETE FROM public.player_season_stat_leaders
  WHERE season_id  = p_season_id
    AND sport_code = p_sport_code
    AND division   = p_division;

  FOREACH v_category IN ARRAY ARRAY['goals','assists','points','shots_on_goal','gk_saves','gk_shutouts']
  LOOP
    INSERT INTO public.player_season_stat_leaders
      (season_id, sport_code, division, category_key, rank, player_season_id, value, computed_at)
    SELECT
      p_season_id, p_sport_code, p_division, v_category, ranked.rnk, ranked.player_season_id, ranked.value, now()
    FROM (
      SELECT
        a.player_season_id,
        row_number() OVER (ORDER BY
          CASE v_category
            WHEN 'goals'         THEN a.goals
            WHEN 'assists'       THEN a.assists
            WHEN 'points'        THEN a.points
            WHEN 'shots_on_goal' THEN a.shots_on_goal
            WHEN 'gk_saves'      THEN a.gk_saves
            WHEN 'gk_shutouts'   THEN a.gk_shutouts
          END DESC NULLS LAST
        ) AS rnk,
        CASE v_category
          WHEN 'goals'         THEN a.goals
          WHEN 'assists'       THEN a.assists
          WHEN 'points'        THEN a.points
          WHEN 'shots_on_goal' THEN a.shots_on_goal
          WHEN 'gk_saves'      THEN a.gk_saves
          WHEN 'gk_shutouts'   THEN a.gk_shutouts
        END AS value
      FROM pg_temp.rpsl_agg a
      WHERE a.games_played > 0
    ) ranked
    WHERE ranked.rnk <= 6
      AND ranked.value > 0;

    INSERT INTO public.player_season_stat_category_averages
      (season_id, sport_code, division, category_key, avg_value, qualifying_count, computed_at)
    SELECT
      p_season_id, p_sport_code, p_division, v_category,
      COALESCE(AVG(qualified.value), 0), COUNT(*), now()
    FROM (
      SELECT
        CASE v_category
          WHEN 'goals'         THEN a.goals
          WHEN 'assists'       THEN a.assists
          WHEN 'points'        THEN a.points
          WHEN 'shots_on_goal' THEN a.shots_on_goal
          WHEN 'gk_saves'      THEN a.gk_saves
          WHEN 'gk_shutouts'   THEN a.gk_shutouts
        END AS value
      FROM pg_temp.rpsl_agg a
      WHERE a.games_played > 0
    ) qualified
    WHERE qualified.value > 0
    ON CONFLICT (season_id, sport_code, division, category_key) DO UPDATE SET
      avg_value        = EXCLUDED.avg_value,
      qualifying_count = EXCLUDED.qualifying_count,
      computed_at      = EXCLUDED.computed_at;
  END LOOP;

  DROP TABLE IF EXISTS pg_temp.rpsl_agg;
END;
$$;

REVOKE ALL ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) TO service_role;
