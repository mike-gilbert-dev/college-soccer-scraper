-- players: master record, one per real-world player.
-- ncaa_player_id is a synthetic key "{teamId}_{firstName}_{lastName}" (normalized)
-- because the NCAA box score API provides no stable player ID.
CREATE TABLE players (
  id             bigserial PRIMARY KEY,
  ncaa_player_id text        NOT NULL UNIQUE,
  name           text        NOT NULL,
  created_at     timestamptz DEFAULT now()
);

-- player_seasons: player enrolled on a team in a specific season.
-- Mirrors the teams/team_seasons pattern.
-- UNIQUE(player_id, team_season_id) handles transfers cleanly.
CREATE TABLE player_seasons (
  id             bigserial PRIMARY KEY,
  player_id      bigint      NOT NULL REFERENCES players(id),
  team_season_id bigint      NOT NULL REFERENCES team_seasons(id),
  jersey_number  smallint,
  position       text,       -- 'GK', 'D', 'M', 'F'
  class_year     text,       -- 'FR', 'SO', 'JR', 'SR', 'GR'
  created_at     timestamptz DEFAULT now(),
  UNIQUE (player_id, team_season_id)
);

-- player_game_stats: per-game box score stats, one row per player per game.
-- GK stats (gk_saves, gk_goals_against, gk_shutout) are populated only when
-- a single GK played the full game; otherwise NULL.
-- All numeric values from the API are strings; they are parsed before insertion.
CREATE TABLE player_game_stats (
  id                    bigserial PRIMARY KEY,
  player_season_id      bigint    NOT NULL REFERENCES player_seasons(id),
  game_id               bigint    NOT NULL REFERENCES games(id),
  starter               boolean   DEFAULT false,
  minutes_played        smallint,
  goals                 smallint  DEFAULT 0,
  assists               smallint  DEFAULT 0,
  shots                 smallint  DEFAULT 0,
  shots_on_goal         smallint  DEFAULT 0,
  fouls_committed       smallint  DEFAULT 0,
  yellow_cards          smallint  DEFAULT 0,
  red_cards             smallint  DEFAULT 0,
  green_cards           smallint  DEFAULT 0,
  penalty_shot_goals    smallint  DEFAULT 0,
  penalty_shot_attempts smallint  DEFAULT 0,
  -- GK stats (NULL for non-GK or multi-GK games)
  gk_saves              smallint,
  gk_goals_against      smallint,
  gk_shutout            boolean,
  created_at            timestamptz DEFAULT now(),
  UNIQUE (player_season_id, game_id)
);

-- Indexes for common query patterns
CREATE INDEX player_seasons_player_idx      ON player_seasons(player_id);
CREATE INDEX player_seasons_team_season_idx ON player_seasons(team_season_id);
CREATE INDEX player_game_stats_ps_idx       ON player_game_stats(player_season_id);
CREATE INDEX player_game_stats_game_idx     ON player_game_stats(game_id);

-- Season aggregate view: always computed from game stats, never stored.
CREATE VIEW player_season_stats AS
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
  COALESCE(SUM(pgs.goals), 0) + COALESCE(SUM(pgs.assists), 0) AS points,
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
  COALESCE(SUM(CASE WHEN pgs.gk_shutout THEN 1 ELSE 0 END), 0) AS gk_shutouts
FROM player_seasons ps
JOIN players p ON p.id = ps.player_id
LEFT JOIN player_game_stats pgs ON pgs.player_season_id = ps.id
GROUP BY
  ps.id, ps.player_id, p.ncaa_player_id, p.name,
  ps.team_season_id, ps.jersey_number, ps.position, ps.class_year;

-- Permissions
GRANT ALL    ON players, player_seasons, player_game_stats TO service_role;
GRANT ALL    ON SEQUENCE players_id_seq, player_seasons_id_seq, player_game_stats_id_seq TO service_role;
GRANT SELECT ON players, player_seasons, player_game_stats, player_season_stats TO anon, authenticated;

ALTER TABLE players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_seasons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_game_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read players"           ON players           FOR SELECT USING (true);
CREATE POLICY "public read player_seasons"    ON player_seasons    FOR SELECT USING (true);
CREATE POLICY "public read player_game_stats" ON player_game_stats FOR SELECT USING (true);
