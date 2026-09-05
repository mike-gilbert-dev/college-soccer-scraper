-- Nightly webstream refresh: scrape then ingest, as two queue-draining jobs.
--
-- WHY REPEATED FIRINGS RATHER THAN ONE
-- A pg_cron entry fires once and cannot walk a cursor, and the work does not
-- fit one invocation: measured over the first full run, ingest averages 730ms
-- per source SEQUENTIALLY, so all 566 take ~7 minutes — past an edge function's
-- wall clock. Both functions therefore expose ?mode=queue, where each firing
-- claims the STALEST sources (roster_sources.last_scraped_at / last_ingested_at)
-- and stamps everything it attempted. Twelve firings x 60 = 720 slots against
-- 566 sources, so the queue drains with margin and the surplus firings match
-- nothing and return immediately.
--
-- That shape also means a failed or timed-out firing needs no resume position:
-- whatever it did not stamp is simply still the stalest next time.
--
-- WHY 09:00 AND 10:00 UTC
-- Clear of the existing 08:00 nightly-ingest, 08:05 nightly-reconcile and
-- 08:15 nightly-ratings, so the stream sweep never contends with them. Ingest
-- runs an hour behind scrape so it reads archives written the same morning.
-- 09:00 UTC is ~05:00 ET, well outside any live-game window — which matters
-- because nightly-ingest-live runs every minute and shares the connection pool.
--
-- Scrape is the only phase that touches the outside world: ~566 requests spread
-- across an hour at concurrency 6, one polite pass per school per day.

select cron.schedule(
  'stream-scrape',
  '*/5 9 * * *',
  $$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/stream-scrape?mode=queue&limit=60',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

select cron.schedule(
  'stream-ingest',
  '*/5 10 * * *',
  $$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/stream-ingest?mode=queue&limit=60',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- schedule-discovery is deliberately NOT scheduled. It resolves a source's
-- schedule address, which changes about once a season, and its failures need a
-- human (a school moving to a client-rendered site cannot be fixed by retrying).
-- Run it by hand when the season rolls over:
--   curl -H "Authorization: Bearer <service_role_key>" \
--     "https://<project>.supabase.co/functions/v1/schedule-discovery?limit=60"
-- repeated until it reports "No matching sources" — it self-advances on
-- schedule_status='unverified'.
