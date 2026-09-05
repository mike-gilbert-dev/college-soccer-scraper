-- Webstream link ingestion — Phase 1 foundation.
--
-- Adds the per-game media-link table, the unmatched-event review queue, the run
-- log, the schedule-address columns on roster_sources, and the raw-schedule
-- Storage bucket. Plan: docs/planning/webstreams/plan-overview.html
--
-- Links come from the schools' own athletics sites (the same domains
-- roster_sources already maps), NOT from the NCAA feed, which carries no
-- broadcast data at all — 0 of 4,956 2026 D1 games have a broadcaster_name.
-- Nothing here writes to games except broadcaster_name; the NCAA feed stays
-- authoritative for date, time, opponent and score.

-- ------------------------------------------------------------
-- 1. roster_sources gains the schedule address.
--    Deliberately NOT a parallel schedule_sources table: this row already maps
--    (team, sport, season) -> domain + platform, and two mappings would drift
--    on which platform a school runs. The table name is now a little narrow
--    for what it holds; that is the cheaper problem.
-- ------------------------------------------------------------
ALTER TABLE roster_sources
  ADD COLUMN sidearm_schedule_id  text,        -- NextGen scheduleId, from /api/v2/Sports
  ADD COLUMN schedule_path        text,        -- e.g. '/sports/msoc/schedule' (HTML platforms)
  ADD COLUMN schedule_status      text NOT NULL DEFAULT 'unverified',
  ADD COLUMN schedule_verified_at timestamptz;

CREATE INDEX roster_sources_schedule_status_idx ON roster_sources (schedule_status);

-- ------------------------------------------------------------
-- 2. game_streams — one row per (game, kind, link).
--
-- A game can carry a home-school link, an away-school link, live stats and a
-- radio feed, and those change as kickoff approaches: one-to-many with its own
-- lifecycle, so not columns on games.
--
-- Three INDEPENDENT axes, which is the part worth not collapsing:
--   is_deep_link — does this URL point at THIS game, or at a landing page?
--   access       — what does the viewer need: nothing, a sub, or a cable login?
--   carrier      — who is showing it (normalized; see src/lib/server/carriers.ts)
-- They do not correlate. A B1G+ per-game link is deep AND paywalled;
-- foxsports.com/live/btn is generic AND cable-gated; a school's own
-- /showcase?Live=7307 is deep AND free.
--
-- url is nullable: 35 of 387 sampled events named a carrier with no link. Those
-- rows are how /scores says "on ACC Network" for a game with nothing to click.
-- ------------------------------------------------------------
CREATE TABLE game_streams (
  id                bigserial   PRIMARY KEY,
  game_id           bigint      NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  kind              text        NOT NULL
                                CHECK (kind IN ('video', 'audio', 'stats', 'tickets')),
  url               text,
  label             text,                    -- 'Watch', 'Live stats' — as published
  carrier           text,                    -- 'espn_plus' | 'b1g_plus' | 'accn' | ...
  access            text        NOT NULL DEFAULT 'unknown'
                                CHECK (access IN ('free', 'subscription', 'tv_authenticated', 'unknown')),
  is_deep_link      boolean     NOT NULL DEFAULT false,
  source_side       text        NOT NULL CHECK (source_side IN ('home', 'away')),
  roster_source_id  bigint      NOT NULL REFERENCES roster_sources (id) ON DELETE CASCADE,
  external_event_id text,                    -- Sidearm game id / WMT entity-id
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

-- A row is identified by its link; carrier-only rows dedupe on the carrier.
-- Expression index rather than a plain UNIQUE because url is nullable and two
-- NULLs would otherwise not conflict.
CREATE UNIQUE INDEX game_streams_identity_idx
  ON game_streams (game_id, kind, COALESCE(url, carrier));

CREATE INDEX game_streams_game_idx      ON game_streams (game_id);
CREATE INDEX game_streams_source_idx    ON game_streams (roster_source_id);
-- Stale-link sweeps ("not seen in 14 days") are a date scan over video rows.
CREATE INDEX game_streams_last_seen_idx ON game_streams (last_seen_at) WHERE kind = 'video';

-- ------------------------------------------------------------
-- 3. game_primary_stream — the one link worth showing per game.
--
-- FOR ADMIN AND REPORTING ONLY. /scores must NOT query this view: DISTINCT ON
-- over the whole table can be materialized before a game_id filter is applied,
-- turning a scoreboard render into a full scan. The page instead does a second
-- query against game_streams filtered by .in('game_id', ids) over the <=100
-- games already on screen — the same shape /scores already uses for pick'em.
--
-- Preference: a link to THIS game beats a landing page; free beats a
-- subscription beats a cable login; the home school beats the away school.
-- ------------------------------------------------------------
CREATE VIEW game_primary_stream AS
SELECT DISTINCT ON (game_id)
       game_id, url, carrier, access, label, is_deep_link, source_side, last_seen_at
FROM   game_streams
WHERE  kind = 'video' AND url IS NOT NULL
ORDER  BY game_id,
          is_deep_link DESC,
          array_position(ARRAY['free', 'subscription', 'unknown', 'tv_authenticated'], access),
          (source_side = 'home') DESC,
          last_seen_at DESC;

-- ------------------------------------------------------------
-- 4. stream_entry_queue — schedule events that did not match a game.
--    Mirrors roster_entry_queue: nothing is dropped silently, and nothing
--    creates a game. The NCAA feed owns which games exist.
-- ------------------------------------------------------------
CREATE TABLE stream_entry_queue (
  id               bigserial   PRIMARY KEY,
  roster_source_id bigint      NOT NULL REFERENCES roster_sources (id) ON DELETE CASCADE,
  -- raw external fields, verbatim from the school's schedule
  event_date       date,
  opponent_name    text,
  location_side    text,                     -- 'H' | 'A' | 'N' as published
  video_url        text,
  carrier_raw      text,                     -- the school's own tv string
  external_event_id text,
  -- matcher output
  match_status     text        NOT NULL,     -- 'unmatched' | 'ambiguous'
  suggested_game_id bigint     REFERENCES games (id) ON DELETE SET NULL,
  suggestion_reason text,
  review_status    text        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roster_source_id, event_date, opponent_name)
);

CREATE INDEX stream_entry_queue_review_idx ON stream_entry_queue (review_status);
CREATE INDEX stream_entry_queue_source_idx ON stream_entry_queue (roster_source_id);

-- ------------------------------------------------------------
-- 5. stream_scrape_log — one row per source per run (mirrors
--    roster_scrape_log). A 200 from the edge function does not mean the run
--    succeeded; per-source errors are caught and logged here. Judge runs by
--    this table.
-- ------------------------------------------------------------
CREATE TABLE stream_scrape_log (
  id               bigserial   PRIMARY KEY,
  roster_source_id bigint      REFERENCES roster_sources (id) ON DELETE SET NULL,
  phase            text        NOT NULL CHECK (phase IN ('discovery', 'scrape', 'ingest')),
  status           text        NOT NULL CHECK (status IN ('success', 'error')),
  http_status      int,
  events_seen      int         DEFAULT 0,
  matched          int         DEFAULT 0,
  links_upserted   int         DEFAULT 0,
  queued           int         DEFAULT 0,
  error_message    text,
  duration_ms      int,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stream_scrape_log_created_idx ON stream_scrape_log (created_at DESC);
CREATE INDEX stream_scrape_log_source_idx  ON stream_scrape_log (roster_source_id, created_at DESC);

-- ------------------------------------------------------------
-- 6. Raw schedule archive (private). Source of truth, so a parser fix can be
--    re-run from Storage instead of re-crawling 374 schools.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('schedule-raw', 'schedule-raw', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 7. Grants + RLS. game_streams is public display data; the queue and log are
--    operational (authenticated only), matching the roster tables.
--    NOTE: grants on a table do NOT cascade to a view — game_primary_stream
--    needs its own, or the edge functions read an empty view with no error.
-- ------------------------------------------------------------
GRANT ALL    ON game_streams, stream_entry_queue, stream_scrape_log TO service_role;
GRANT ALL    ON SEQUENCE game_streams_id_seq, stream_entry_queue_id_seq, stream_scrape_log_id_seq TO service_role;
GRANT SELECT ON game_streams TO anon, authenticated;
GRANT SELECT ON stream_entry_queue, stream_scrape_log TO authenticated;
GRANT SELECT ON game_primary_stream TO anon, authenticated, service_role;

ALTER TABLE game_streams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_entry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_scrape_log  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read game_streams"      ON game_streams       FOR SELECT USING (true);
CREATE POLICY "auth read stream_entry_queue"  ON stream_entry_queue FOR SELECT USING (true);
CREATE POLICY "auth read stream_scrape_log"   ON stream_scrape_log  FOR SELECT USING (true);
