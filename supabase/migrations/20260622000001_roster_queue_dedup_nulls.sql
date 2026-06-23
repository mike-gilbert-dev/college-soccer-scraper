-- Roster project — fix: make roster_entry_queue idempotent for null jersey numbers.
-- The original UNIQUE(roster_source_id, first_name, last_name, jersey_number)
-- treats NULL jersey as distinct, so an unmatched player without a jersey was
-- re-inserted on every roster-ingest run. Switch to a NULLS NOT DISTINCT unique
-- index so the upsert conflict-key collapses null jerseys to a single row.

-- 1. Dedupe any rows that already accumulated (keep the lowest id per logical key).
delete from roster_entry_queue a
using roster_entry_queue b
where a.id > b.id
  and a.roster_source_id = b.roster_source_id
  and a.first_name   is not distinct from b.first_name
  and a.last_name    is not distinct from b.last_name
  and a.jersey_number is not distinct from b.jersey_number;

-- 2. Replace the constraint with a NULLS NOT DISTINCT unique index.
alter table roster_entry_queue
  drop constraint roster_entry_queue_roster_source_id_first_name_last_name_je_key;

create unique index roster_entry_queue_dedup_idx
  on roster_entry_queue (roster_source_id, first_name, last_name, jersey_number) nulls not distinct;
