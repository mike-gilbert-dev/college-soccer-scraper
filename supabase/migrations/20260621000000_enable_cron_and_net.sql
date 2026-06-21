-- Enable scheduled jobs (pg_cron) and async HTTP (pg_net) for the nightly
-- scores-ingest pipeline. The nightly-ingest edge function is invoked by a
-- pg_cron job (see 20260621000001_schedule_nightly_ingest.sql).
create extension if not exists pg_cron;
create extension if not exists pg_net;
