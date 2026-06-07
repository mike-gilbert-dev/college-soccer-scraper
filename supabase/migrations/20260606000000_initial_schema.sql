-- ============================================================
-- College Soccer Scraper – initial schema
-- ============================================================

-- ------------------------------------------------------------
-- seasons
-- One row per NCAA season year.
-- ------------------------------------------------------------
CREATE TABLE seasons (
  id          bigserial PRIMARY KEY,
  year        integer   NOT NULL UNIQUE,
  start_date  date      NOT NULL,
  end_date    date      NOT NULL
);

-- Seed the seasons we care about
INSERT INTO seasons (year, start_date, end_date) VALUES
  (2024, '2024-08-01', '2024-12-15'),
  (2025, '2025-08-01', '2025-12-15');


-- ------------------------------------------------------------
-- conferences
-- Scoped per season because memberships change year to year.
-- Upsert key: (ncaa_conference_id, season_id)
-- ------------------------------------------------------------
CREATE TABLE conferences (
  id                 bigserial PRIMARY KEY,
  ncaa_conference_id text      NOT NULL,
  season_id          bigint    NOT NULL REFERENCES seasons (id),
  name               text      NOT NULL,
  short_name         text      NOT NULL,
  division           smallint  NOT NULL CHECK (division BETWEEN 1 AND 3),
  UNIQUE (ncaa_conference_id, season_id)
);


-- ------------------------------------------------------------
-- teams
-- One stable row per NCAA team across all seasons.
-- Upsert key: ncaa_team_id
-- Division stored here reflects the team's current division;
-- the game row is the authoritative record for division at
-- the time of the match.
-- ------------------------------------------------------------
CREATE TABLE teams (
  id            bigserial PRIMARY KEY,
  ncaa_team_id  text      NOT NULL UNIQUE,
  name          text      NOT NULL,
  short_name    text      NOT NULL,
  division      smallint  NOT NULL CHECK (division BETWEEN 1 AND 3)
);


-- ------------------------------------------------------------
-- games
-- One row per contest.
-- Upsert key: ncaa_contest_id
-- conference_id is nullable — non-conference games have none.
-- Scores are null until the game is played.
-- last_fetched_at drives the polling skip logic:
--   if status = 'final', never re-fetch.
-- ------------------------------------------------------------
CREATE TABLE games (
  id               bigserial   PRIMARY KEY,
  ncaa_contest_id  text        NOT NULL UNIQUE,
  season_id        bigint      NOT NULL REFERENCES seasons (id),
  contest_date     date        NOT NULL,
  start_time       timestamptz,
  home_team_id     bigint      NOT NULL REFERENCES teams (id),
  away_team_id     bigint      NOT NULL REFERENCES teams (id),
  conference_id    bigint      REFERENCES conferences (id),
  home_score       smallint,
  away_score       smallint,
  status           text        NOT NULL DEFAULT 'scheduled'
                               CHECK (status IN ('scheduled', 'live', 'final', 'postponed', 'cancelled')),
  neutral_site     boolean     NOT NULL DEFAULT false,
  division         smallint    NOT NULL CHECK (division BETWEEN 1 AND 3),
  last_fetched_at  timestamptz
);

-- Most common query: games on a date, filtered by status
CREATE INDEX games_contest_date_idx      ON games (contest_date);
CREATE INDEX games_season_date_idx       ON games (season_id, contest_date);
CREATE INDEX games_home_team_idx         ON games (home_team_id);
CREATE INDEX games_away_team_idx         ON games (away_team_id);
CREATE INDEX games_conference_idx        ON games (conference_id);
-- Partial index: only non-terminal rows need to appear in polling queries
CREATE INDEX games_needs_update_idx      ON games (contest_date, last_fetched_at)
  WHERE status IN ('scheduled', 'live');


-- ------------------------------------------------------------
-- scrape_log
-- Append-only audit trail. Never update rows.
-- Used to audit request volume and catch runaway polling.
-- ------------------------------------------------------------
CREATE TABLE scrape_log (
  id              bigserial   PRIMARY KEY,
  endpoint        text        NOT NULL,
  contest_date    date,                   -- null for non-date queries
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  http_status     smallint,
  status          text        NOT NULL CHECK (status IN ('success', 'error')),
  games_upserted  integer,
  error_message   text
);

CREATE INDEX scrape_log_endpoint_date_idx ON scrape_log (endpoint, contest_date);
CREATE INDEX scrape_log_fetched_at_idx    ON scrape_log (fetched_at DESC);
