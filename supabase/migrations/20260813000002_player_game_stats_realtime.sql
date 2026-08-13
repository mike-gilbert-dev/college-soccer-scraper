-- Enable Supabase Realtime on `player_game_stats` so the box score page can
-- receive live stat updates pushed over a websocket, the same way `games` was
-- wired up for live scores (20260628000001_games_realtime.sql).
--
-- This does NOT change the table or duplicate data — it adds
-- `player_game_stats` to the `supabase_realtime` logical-replication
-- publication so row changes (from nightly-reconcile ?mode=live) stream to
-- subscribed clients. Realtime respects RLS; the existing public-read policy
-- means anonymous visitors receive these rows. Default REPLICA IDENTITY
-- (primary key) is sufficient — clients only need `new` row values, matched
-- by id or (player_season_id, game_id).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_game_stats'
  ) then
    alter publication supabase_realtime add table public.player_game_stats;
  end if;
end $$;
