-- /stats' leaderboard charts plot each leader's trend against a field-average
-- reference line -- the mean value across every qualifying player in the
-- category, not just the top 6. That average has to come from a full-league
-- pass, so it can't be derived from player_season_stat_leaders alone (which
-- only holds the top 6). Store it alongside the leaders, refreshed by the same
-- function/cadence.
CREATE TABLE player_season_stat_category_averages (
  season_id        bigint      NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  sport_code       text        NOT NULL,
  division         integer     NOT NULL,
  category_key     text        NOT NULL,
  avg_value        numeric     NOT NULL,
  qualifying_count integer     NOT NULL,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, sport_code, division, category_key)
);

GRANT ALL ON player_season_stat_category_averages TO service_role;
GRANT SELECT ON player_season_stat_category_averages TO anon, authenticated;

ALTER TABLE player_season_stat_category_averages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read player_season_stat_category_averages"
  ON player_season_stat_category_averages FOR SELECT USING (true);

-- Extend refresh_player_stat_leaders() to also upsert each category's field
-- average (same qualifying-player filter as the leaders themselves: games_played
-- > 0 and value > 0), rather than adding a second RPC call.
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
  INSERT INTO public.team_season_stat_totals
    (team_season_id, shots, shots_on_goal, fouls, yellow_cards, red_cards, computed_at)
  SELECT
    pss.team_season_id,
    SUM(pss.shots),
    SUM(pss.shots_on_goal),
    SUM(pss.fouls),
    SUM(pss.yellow_cards),
    SUM(pss.red_cards),
    now()
  FROM public.player_season_stats pss
  JOIN public.team_seasons ts ON ts.id = pss.team_season_id
  WHERE ts.season_id = p_season_id
    AND ts.sport_code = p_sport_code
    AND ts.division   = p_division
  GROUP BY pss.team_season_id
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
        pss.player_season_id,
        row_number() OVER (ORDER BY
          CASE v_category
            WHEN 'goals'         THEN pss.goals
            WHEN 'assists'       THEN pss.assists
            WHEN 'points'        THEN pss.points
            WHEN 'shots_on_goal' THEN pss.shots_on_goal
            WHEN 'gk_saves'      THEN pss.gk_saves
            WHEN 'gk_shutouts'   THEN pss.gk_shutouts
          END DESC NULLS LAST
        ) AS rnk,
        CASE v_category
          WHEN 'goals'         THEN pss.goals
          WHEN 'assists'       THEN pss.assists
          WHEN 'points'        THEN pss.points
          WHEN 'shots_on_goal' THEN pss.shots_on_goal
          WHEN 'gk_saves'      THEN pss.gk_saves
          WHEN 'gk_shutouts'   THEN pss.gk_shutouts
        END AS value
      FROM public.player_season_stats pss
      JOIN public.team_seasons ts ON ts.id = pss.team_season_id
      WHERE ts.season_id = p_season_id
        AND ts.sport_code = p_sport_code
        AND ts.division   = p_division
        AND pss.games_played > 0
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
          WHEN 'goals'         THEN pss.goals
          WHEN 'assists'       THEN pss.assists
          WHEN 'points'        THEN pss.points
          WHEN 'shots_on_goal' THEN pss.shots_on_goal
          WHEN 'gk_saves'      THEN pss.gk_saves
          WHEN 'gk_shutouts'   THEN pss.gk_shutouts
        END AS value
      FROM public.player_season_stats pss
      JOIN public.team_seasons ts ON ts.id = pss.team_season_id
      WHERE ts.season_id = p_season_id
        AND ts.sport_code = p_sport_code
        AND ts.division   = p_division
        AND pss.games_played > 0
    ) qualified
    WHERE qualified.value > 0
    ON CONFLICT (season_id, sport_code, division, category_key) DO UPDATE SET
      avg_value        = EXCLUDED.avg_value,
      qualifying_count = EXCLUDED.qualifying_count,
      computed_at       = EXCLUDED.computed_at;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) TO service_role;
