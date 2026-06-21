-- Nightly player-stats reconciliation at 08:05 UTC — 5 min after nightly-ingest,
-- so the day's games exist before box scores are fetched. Calls the
-- nightly-reconcile edge function via pg_net; service-role key from Vault
-- (secret 'edge_service_key'). Ratings (08:15) are unaffected — reconcile only
-- writes player_game_stats, not games.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-reconcile') then
    perform cron.unschedule('nightly-reconcile');
  end if;
end $$;

select cron.schedule(
  'nightly-reconcile',
  '5 8 * * *',
  $job$
  select net.http_post(
    url := 'https://jiyjljwubgrxktztinyy.supabase.co/functions/v1/nightly-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
