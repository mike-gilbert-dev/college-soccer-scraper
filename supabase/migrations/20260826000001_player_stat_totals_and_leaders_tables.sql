-- Precomputed /stats leaderboard data. player_season_stats (view) aggregates
-- live over all of player_game_stats on every query; querying it across the
-- whole league (all ~200 teams) on every /stats page load became slow enough
-- to hit Postgres's statement timeout as player_game_stats grew through the
-- season (see 2026-08-25 01:22 UTC 500). These tables hold nightly + live-window
-- snapshots instead; /teams/[id] and /players/[id] (single team/player, not
-- league-wide) keep reading the live view unchanged.

CREATE TABLE team_season_stat_totals (
  team_season_id bigint PRIMARY KEY REFERENCES team_seasons(id) ON DELETE CASCADE,
  shots          integer     NOT NULL DEFAULT 0,
  shots_on_goal  integer     NOT NULL DEFAULT 0,
  fouls          integer     NOT NULL DEFAULT 0,
  yellow_cards   integer     NOT NULL DEFAULT 0,
  red_cards      integer     NOT NULL DEFAULT 0,
  computed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_season_stat_leaders (
  id               bigserial PRIMARY KEY,
  season_id        bigint      NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  sport_code       text        NOT NULL,
  division         integer     NOT NULL,
  category_key     text        NOT NULL, -- goals | assists | points | shots_on_goal | gk_saves | gk_shutouts
  rank             integer     NOT NULL,
  player_season_id bigint      NOT NULL REFERENCES player_seasons(id) ON DELETE CASCADE,
  value            numeric     NOT NULL,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, sport_code, division, category_key, rank)
);

CREATE INDEX player_season_stat_leaders_lookup_idx
  ON player_season_stat_leaders (season_id, sport_code, division, category_key);

GRANT ALL ON team_season_stat_totals, player_season_stat_leaders TO service_role;
GRANT ALL ON SEQUENCE player_season_stat_leaders_id_seq TO service_role;
GRANT SELECT ON team_season_stat_totals, player_season_stat_leaders TO anon, authenticated;

ALTER TABLE team_season_stat_totals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_season_stat_leaders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read team_season_stat_totals"    ON team_season_stat_totals    FOR SELECT USING (true);
CREATE POLICY "public read player_season_stat_leaders" ON player_season_stat_leaders FOR SELECT USING (true);
