-- PostgREST's on_conflict= takes column names, so it cannot target the
-- expression index on COALESCE(url, carrier) created in 20260904000000.
-- Materialize that expression as a generated column and key the unique index on
-- it instead, so stream-ingest can upsert on (game_id, kind, link_key).
DROP INDEX IF EXISTS game_streams_identity_idx;

ALTER TABLE game_streams
  ADD COLUMN link_key text GENERATED ALWAYS AS (COALESCE(url, carrier)) STORED;

CREATE UNIQUE INDEX game_streams_identity_idx
  ON game_streams (game_id, kind, link_key);
