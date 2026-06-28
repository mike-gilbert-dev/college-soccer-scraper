-- Enable Supabase Realtime on the `games` table so the scoreboard can receive
-- live score/status updates pushed over a websocket (Phase 2 of live scores).
--
-- This does NOT change the table or duplicate data — it adds `games` to the
-- `supabase_realtime` logical-replication publication so row changes (the live
-- upserts from nightly-ingest ?mode=live) are streamed to subscribed clients.
-- Realtime respects RLS: the existing "public read games" SELECT policy means
-- anonymous visitors receive these rows. Default REPLICA IDENTITY (primary key)
-- is sufficient — the client only needs `new` row values, matched by id.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
