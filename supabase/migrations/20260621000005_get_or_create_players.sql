-- Insert any new players (by ncaa_player_id) using the raw NCAA name, but NEVER
-- overwrite the name of a player that already exists — so externally-normalized
-- name formatting is preserved across nightly reconcile / ingest runs. Returns
-- the id <-> ncaa_player_id mapping for every input player in one round-trip.
--
-- Used by the nightly-reconcile edge function and src/lib/server/ingest.ts in
-- place of an `upsert(... name ...)`, which would clobber normalized names.
create or replace function get_or_create_players(p_players jsonb)
returns table (id bigint, ncaa_player_id text)
language plpgsql
as $$
begin
  insert into players (ncaa_player_id, name)
  select x.ncaa_player_id, x.name
  from jsonb_to_recordset(p_players) as x(ncaa_player_id text, name text)
  on conflict (ncaa_player_id) do nothing;

  return query
  select p.id, p.ncaa_player_id
  from players p
  where p.ncaa_player_id in (
    select x.ncaa_player_id
    from jsonb_to_recordset(p_players) as x(ncaa_player_id text)
  );
end;
$$;

grant execute on function get_or_create_players(jsonb) to service_role;
