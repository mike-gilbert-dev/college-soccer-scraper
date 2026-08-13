-- Live player-stats poll: invoke `nightly-reconcile` in live mode every 10
-- minutes.
--
-- Live mode (?mode=live) self-gates inside the function: it first checks
-- whether any game this season currently has status='live' (kept current by
-- nightly-ingest's own per-minute live poll); if none, it no-ops *without*
-- calling the NCAA API. Unlike the score poll, this fetches one box score per
-- live game rather than a single bulk call, so it intentionally runs on a much
-- coarser cadence (10 min, not every minute) and starts at a conservative
-- concurrency (default 4) to go easy on an endpoint that publishes no rate
-- limit of its own. Tighten the interval later once behavior in the wild is
-- confirmed safe.
--
-- Live mode also skips the Storage archive and reconciliation_log (kept cheap,
-- same pattern as nightly-ingest's live mode) — the overnight nightly-reconcile
-- run still produces the canonical archive + log once games go final.
--
-- Same Vault secret ('edge_service_key') and off-season no-op behavior as the
-- other cron jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-reconcile-live') then
    perform cron.unschedule('nightly-reconcile-live');
  end if;
end $$;

select cron.schedule(
  'nightly-reconcile-live',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/nightly-reconcile?mode=live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
