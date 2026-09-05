-- Distinguish "nothing to do" from "something went wrong" in stream_scrape_log.
--
-- The first full 566-source ingest logged 35 errors reading
-- "no team_season for this source". None of them was a fault: they are non-D1
-- schools (Ashland, Brandeis, Colorado Mines, Molloy, Rockhurst, ...) that
-- exist in `teams` only because they appear as opponents in the D1 feed. 34 of
-- the 35 have no 2026 team_seasons row for that sport, and only 3 are ever
-- division_member, so there are no games for a link to attach to.
--
-- That matters because stream_scrape_log is the thing a run is judged by — a
-- 200 from the edge function does not mean the run succeeded. Thirty-five
-- standing red herrings every night would make the log useless exactly where it
-- is meant to be authoritative, so these get their own status.

ALTER TABLE stream_scrape_log DROP CONSTRAINT stream_scrape_log_status_check;

ALTER TABLE stream_scrape_log ADD CONSTRAINT stream_scrape_log_status_check
  CHECK (status IN ('success', 'error', 'skipped'));

-- Reclassify the existing rows so the history reads correctly too.
UPDATE stream_scrape_log
SET status = 'skipped'
WHERE phase = 'ingest'
  AND status = 'error'
  AND error_message = 'no team_season for this source';
