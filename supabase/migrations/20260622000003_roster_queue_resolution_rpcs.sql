-- Roster project — Phase 5: queue-resolution RPCs used by the /admin review UI.
-- Players are created ONLY here (on explicit human approval), never by the matcher.
-- All run as the service role from server-side form actions.

-- Reject: drop a pending entry from review (won't be re-surfaced; roster-ingest
-- preserves review_status on re-runs).
create or replace function roster_queue_reject(p_queue_id bigint)
returns void language sql as $$
  update roster_entry_queue set review_status='rejected', reviewed_at=now()
  where id = p_queue_id and review_status='pending';
$$;

-- Approve -> link: attach a pending entry to an existing player_season (in the
-- same team-season) and enrich it (roster authoritative for headshot/height/
-- hometown/class_year; fill-null for jersey/position; never touch players.name).
create or replace function roster_queue_approve_link(p_queue_id bigint, p_player_season_id bigint)
returns void language plpgsql as $$
declare q roster_entry_queue%rowtype; v_ts bigint;
begin
  select * into q from roster_entry_queue where id = p_queue_id and review_status='pending';
  if not found then raise exception 'queue entry % not found or not pending', p_queue_id; end if;
  select team_season_id into v_ts from player_seasons where id = p_player_season_id;
  if not found then raise exception 'player_season % not found', p_player_season_id; end if;
  if v_ts <> q.team_season_id then
    raise exception 'player_season team_season % does not match queue team_season %', v_ts, q.team_season_id;
  end if;
  update player_seasons set
    headshot_url     = coalesce(q.headshot_url, headshot_url),
    height           = coalesce(q.height, height),
    hometown         = coalesce(q.hometown, hometown),
    class_year       = coalesce(q.class_year, class_year),
    jersey_number    = coalesce(jersey_number, q.jersey_number),
    position         = coalesce(position, q.position),
    roster_source_id = q.roster_source_id,
    roster_synced_at = now()
  where id = p_player_season_id;
  update roster_entry_queue set review_status='approved', reviewed_at=now() where id = p_queue_id;
end; $$;

-- Approve -> create: mint a new player (synthetic ncaa_player_id, roster-origin
-- prefix) + player_season for the entry's team-season, enriched from the entry.
-- Returns the new player_season id.
create or replace function roster_queue_approve_create(p_queue_id bigint)
returns bigint language plpgsql as $$
declare q roster_entry_queue%rowtype; v_ncaa text; v_player_id bigint; v_ps_id bigint;
begin
  select * into q from roster_entry_queue where id = p_queue_id and review_status='pending';
  if not found then raise exception 'queue entry % not found or not pending', p_queue_id; end if;
  -- roster-origin synthetic key (distinct from box-score "{ncaaTeamId}_{first}_{last}")
  v_ncaa := 'rs' || q.roster_source_id || '_' ||
            regexp_replace(lower(coalesce(q.first_name,'') || '_' || coalesce(q.last_name,'')), '[^a-z0-9]+', '_', 'g');
  insert into players (ncaa_player_id, name)
    values (v_ncaa, trim(coalesce(q.first_name,'') || ' ' || coalesce(q.last_name,'')))
    on conflict (ncaa_player_id) do nothing;
  select id into v_player_id from players where ncaa_player_id = v_ncaa;
  insert into player_seasons (player_id, team_season_id, jersey_number, position, class_year,
                              headshot_url, height, hometown, roster_source_id, roster_synced_at)
    values (v_player_id, q.team_season_id, q.jersey_number, q.position, q.class_year,
            q.headshot_url, q.height, q.hometown, q.roster_source_id, now())
    on conflict (player_id, team_season_id) do update set
      jersey_number    = coalesce(player_seasons.jersey_number, excluded.jersey_number),
      position         = coalesce(player_seasons.position, excluded.position),
      class_year       = coalesce(excluded.class_year, player_seasons.class_year),
      headshot_url     = coalesce(excluded.headshot_url, player_seasons.headshot_url),
      height           = coalesce(excluded.height, player_seasons.height),
      hometown         = coalesce(excluded.hometown, player_seasons.hometown),
      roster_source_id = excluded.roster_source_id,
      roster_synced_at = now()
    returning id into v_ps_id;
  update roster_entry_queue set review_status='approved', reviewed_at=now() where id = p_queue_id;
  return v_ps_id;
end; $$;

grant execute on function roster_queue_reject(bigint) to service_role;
grant execute on function roster_queue_approve_link(bigint, bigint) to service_role;
grant execute on function roster_queue_approve_create(bigint) to service_role;
