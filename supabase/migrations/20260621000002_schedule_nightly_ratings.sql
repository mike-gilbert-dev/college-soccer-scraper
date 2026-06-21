-- Nightly ratings recompute at 08:15 UTC — 15 min after nightly-ingest, so the
-- day's scores are in before Elo/RPI/Power are rebuilt. Calls the Vercel
-- /api/cron/nightly?phase=ratings endpoint (recompute is non-chatty and fits
-- Vercel's 60s budget; it reuses the same code as the admin "Recompute Ratings"
-- panel, avoiding a duplicate rating engine).
--
-- CRON_SECRET is read from Vault (secret 'vercel_cron_secret'), created
-- out-of-band — never committed:
--   select vault.create_secret('<CRON_SECRET>', 'vercel_cron_secret', '...');
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-ratings') then
    perform cron.unschedule('nightly-ratings');
  end if;
end $$;

select cron.schedule(
  'nightly-ratings',
  '15 8 * * *',
  $job$
  select net.http_get(
    url := 'https://collegesoccer.io/api/cron/nightly?phase=ratings',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$
);
