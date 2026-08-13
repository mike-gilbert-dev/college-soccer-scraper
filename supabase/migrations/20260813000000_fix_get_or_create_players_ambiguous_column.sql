-- get_or_create_players failed with "column reference \"ncaa_player_id\" is
-- ambiguous" on any real batch: RETURNS TABLE(id, ncaa_player_id) makes
-- ncaa_player_id a plpgsql variable in scope for the whole body, which
-- collides with the unqualified `on conflict (ncaa_player_id)` target column
-- under the default plpgsql.variable_conflict = error. use_column tells
-- plpgsql to prefer the SQL column over the same-named OUT variable, which is
-- what every reference in this function actually means.
create or replace function get_or_create_players(p_players jsonb)
returns table (id bigint, ncaa_player_id text)
language plpgsql
as $$
#variable_conflict use_column
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
