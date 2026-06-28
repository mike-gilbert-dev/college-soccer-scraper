-- Live in-game scores poll: invoke `nightly-ingest` in live mode every minute.
--
-- Live mode (?mode=live) is today-only and SELF-GATES inside the function: it
-- first checks whether any game this season has a start_time within
-- [now - 3h, now + 15m]; if none, it no-ops *without* calling the NCAA API.
-- So this job is near-free off-hours and in the off-season, wakes itself for any
-- game day with no calendar to maintain, and skips the Storage archive + per-run
-- scrape_log writes (a live run is ~1-2s).
--
-- Same Vault secret ('edge_service_key') and season no-op behavior as the nightly
-- ingest. Final scores still get their canonical archive + player stats + ratings
-- from the overnight jobs; this only keeps live scores fresh during games.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-ingest-live') then
    perform cron.unschedule('nightly-ingest-live');
  end if;
end $$;

select cron.schedule(
  'nightly-ingest-live',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/nightly-ingest?mode=live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
