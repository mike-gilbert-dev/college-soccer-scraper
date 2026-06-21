-- Schedule the nightly scores ingest at 08:00 UTC (~4am ET, after the prior
-- day's games settle). The job calls the `nightly-ingest` edge function via
-- pg_net. The service-role key is read from Vault at run time (secret name
-- 'edge_service_key'), so no credential is committed here.
--
-- The Vault secret is created out-of-band (not in a migration), e.g.:
--   select vault.create_secret('<service_role_key>', 'edge_service_key', '...');
--
-- The edge function resolves the active season itself and no-ops in the
-- off-season, so this job is safe to leave scheduled year-round.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-ingest') then
    perform cron.unschedule('nightly-ingest');
  end if;
end $$;

select cron.schedule(
  'nightly-ingest',
  '0 8 * * *',
  $job$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/nightly-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
