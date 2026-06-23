-- Roster project — Phase 1 foundation.
-- Adds the team->external-roster source mapping, season-scoped roster fields on
-- player_seasons, the review/staging queue, the run log, the raw-roster Storage
-- bucket, and a verified NC State seed so Phases 2-4 are testable.

-- 1. roster_sources: one row per (team_id, sport_code, season_id) -> external roster.
create table roster_sources (
  id                bigserial primary key,
  team_id           bigint  not null references teams (id),
  sport_code        text    not null,
  season_id         bigint  not null references seasons (id),
  domain            text,                                    -- e.g. 'gopack.com'
  platform          text    not null default 'unknown',      -- 'sidearm' | 'presto' | 'custom' | 'unknown'
  sidearm_roster_id text,                                    -- e.g. '426'
  status            text    not null default 'unverified',   -- 'verified' | 'unverified' | 'failed'
  last_verified_at  timestamptz,
  notes             text,
  created_at        timestamptz default now(),
  unique (team_id, sport_code, season_id)
);
create index roster_sources_status_idx on roster_sources (status);

-- 2. Season-scoped roster fields on player_seasons (class_year already exists).
alter table player_seasons
  add column headshot_url     text,
  add column height           text,    -- raw, e.g. '5-8'; not parsed
  add column hometown         text,
  add column roster_source_id bigint references roster_sources (id),
  add column roster_synced_at timestamptz;

-- 3. roster_entry_queue: external entries that could not be confidently matched.
create table roster_entry_queue (
  id               bigserial primary key,
  roster_source_id bigint not null references roster_sources (id),
  team_season_id   bigint not null references team_seasons (id),
  -- raw external fields (verbatim from Sidearm)
  first_name       text,
  last_name        text,
  jersey_number    smallint,
  position         text,
  class_year       text,
  height           text,
  hometown         text,
  headshot_url     text,
  external_ref     text,
  -- matcher output
  match_status     text not null,   -- 'unmatched' | 'ambiguous'
  suggested_player_season_id bigint references player_seasons (id),
  suggestion_reason text,
  review_status    text not null default 'pending',   -- 'pending' | 'approved' | 'rejected'
  reviewed_at      timestamptz,
  created_at       timestamptz default now(),
  unique (roster_source_id, first_name, last_name, jersey_number)
);
create index roster_entry_queue_review_idx on roster_entry_queue (review_status);
create index roster_entry_queue_source_idx on roster_entry_queue (roster_source_id);

-- 4. roster_scrape_log: one row per source per run (mirrors reconciliation_log).
create table roster_scrape_log (
  id               bigserial primary key,
  roster_source_id bigint references roster_sources (id),
  status           text not null,    -- 'success' | 'error'
  http_status      int,
  entries_seen     int default 0,
  matched          int default 0,
  enriched         int default 0,
  queued           int default 0,
  error_message    text,
  duration_ms      int,
  created_at       timestamptz default now()
);
create index roster_scrape_log_created_idx on roster_scrape_log (created_at desc);

-- 5. Private Storage bucket for raw roster JSON (source of truth).
insert into storage.buckets (id, name, public)
values ('sidearm-raw-rosters', 'sidearm-raw-rosters', false)
on conflict (id) do nothing;

-- 6. Grants / RLS (mirror existing convention: service_role full; read access;
--    RLS enabled). roster_sources is reference data (public read like teams);
--    the queue and log are operational, so admin-gated (authenticated only).
grant all on roster_sources, roster_entry_queue, roster_scrape_log to service_role;
grant all on sequence roster_sources_id_seq, roster_entry_queue_id_seq, roster_scrape_log_id_seq to service_role;
grant select on roster_sources to anon, authenticated;
grant select on roster_entry_queue, roster_scrape_log to authenticated;

alter table roster_sources     enable row level security;
alter table roster_entry_queue enable row level security;
alter table roster_scrape_log  enable row level security;

create policy "public read roster_sources"    on roster_sources     for select using (true);
create policy "auth read roster_entry_queue"  on roster_entry_queue for select using (true);
create policy "auth read roster_scrape_log"   on roster_scrape_log  for select using (true);

-- 7. Seed NC State MSO (verified) for the latest season so Phases 2-4 are testable.
--    Resolves team_id and season_id dynamically (no hardcoded ids).
-- Roster id is resolved per season via the Sidearm list endpoint
-- (https://gopack.com/api/v2/Rosters/list?sport=msoc), matching the entry whose
-- seasonTitle = the season's start year. For the latest season (2025-2026, start
-- 2025) that is roster 405 (the "2025" roster) -- NOT 426, which is the upcoming
-- "2026" season that has no internal players yet.
insert into roster_sources (team_id, sport_code, season_id, domain, platform, sidearm_roster_id, status, last_verified_at, notes)
select t.id, 'MSO', s.id, 'gopack.com', 'sidearm', '405', 'verified', now(),
       'Seeded in Phase 1 for pipeline bring-up; gopack.com Rosters/405 (2025 season).'
from teams t
cross join lateral (select id from seasons order by start_date desc limit 1) s
where t.ncaa_team_id = 'north-carolina-st'
on conflict (team_id, sport_code, season_id) do nothing;
