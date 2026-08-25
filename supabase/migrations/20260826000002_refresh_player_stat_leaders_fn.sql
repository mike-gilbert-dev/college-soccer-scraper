-- Recomputes team_season_stat_totals + player_season_stat_leaders for one
-- (season, sport, division) target. Called via RPC from nightly-reconcile right
-- after it upserts player_game_stats, both in default (nightly, 08:05 UTC) and
-- ?mode=live (every 10 min while games are in progress) runs -- so /stats stays
-- fresh on the same cadence nightly-reconcile already keeps games/box scores on,
-- with no separate cron job needed.
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
  -- Team-level shot/foul/card totals, summed from the per-player season view
  -- across every team in this season/sport/division.
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

  -- Top-6 leaders per stat category. Cleared and reinserted each run (rather
  -- than upserted by rank) so a category whose qualifying-player pool shrinks
  -- -- e.g. a box score correction reduces someone's stats -- can't leave a
  -- stale occupant sitting in a rank slot nothing refreshed.
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
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_player_stat_leaders(bigint, text, integer) TO service_role;
