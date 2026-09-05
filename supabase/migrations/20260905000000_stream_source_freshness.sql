-- Turn the stream pipeline into a self-advancing work queue.
--
-- Both stream-scrape and stream-ingest page with ?limit= and ?after=. That is
-- fine by hand, but a pg_cron entry fires ONCE — it cannot walk a cursor — so a
-- naive schedule would silently process only the first `limit` sources every
-- night and never touch the rest.
--
-- Sizing rules it out too: measured over the first full run, scrape averages
-- 722ms/source at concurrency 6 (~68s for all 566, one invocation is fine) but
-- ingest averages 730ms/source SEQUENTIALLY, which is ~7 minutes — past an edge
-- function's wall clock.
--
-- So instead of a cursor, each firing claims the N STALEST sources. Cron fires
-- repeatedly within an hour; once everything is fresh the remaining firings
-- find nothing and cost nothing. That also means a failed or timed-out run
-- simply retries on the next firing rather than needing a resume position.
ALTER TABLE roster_sources
  ADD COLUMN last_scraped_at  timestamptz,
  ADD COLUMN last_ingested_at timestamptz;

-- Each phase reads "oldest first, nulls first", so these carry the ordering.
-- Partial on schedule_status because that is always in the predicate.
CREATE INDEX roster_sources_scrape_queue_idx
  ON roster_sources (last_scraped_at NULLS FIRST)
  WHERE status = 'verified' AND schedule_status = 'verified';

CREATE INDEX roster_sources_ingest_queue_idx
  ON roster_sources (last_ingested_at NULLS FIRST)
  WHERE status = 'verified' AND schedule_status = 'verified';

COMMENT ON COLUMN roster_sources.last_scraped_at IS
  'When stream-scrape last ATTEMPTED this source. Stamped on failure too, so a '
  'persistently broken site cannot monopolise every firing of the queue.';
COMMENT ON COLUMN roster_sources.last_ingested_at IS
  'When stream-ingest last ATTEMPTED this source (including a skip). Same '
  'reasoning as last_scraped_at.';
