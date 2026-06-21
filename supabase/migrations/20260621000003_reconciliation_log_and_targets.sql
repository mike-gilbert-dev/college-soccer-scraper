-- Audit trail for the nightly-reconcile edge function: one row per sport/division
-- per run, recording what box scores were (re)fetched and player stats upserted,
-- plus the season-wide finals-missing-stats count before/after.
create table if not exists reconciliation_log (
  id                   bigserial primary key,
  run_at               timestamptz not null default now(),
  sport_code           text        not null,
  division             integer     not null,
  season_id            bigint,
  targets_considered   integer     not null default 0,
  boxscores_fetched    integer     not null default 0,
  games_with_stats     integer     not null default 0,
  stats_upserted       integer     not null default 0,
  finals_missing_before integer    not null default 0,
  finals_missing_after  integer    not null default 0,
  capped               boolean     not null default false,
  duration_ms          integer,
  errors               jsonb       not null default '[]'::jsonb
);

create index if not exists reconciliation_log_run_at_idx on reconciliation_log (run_at desc);

grant all    on reconciliation_log to service_role;
grant usage, select on sequence reconciliation_log_id_seq to service_role;
grant select on reconciliation_log to authenticated;

alter table reconciliation_log enable row level security;
create policy "auth read reconciliation_log" on reconciliation_log for select using (true);

-- Returns final games that the reconcile pass should fetch box scores for:
-- recently-final games (to catch corrections / brand-new stats) OR any final
-- still missing player stats (season-wide gap fill). Capped, recent-first.
create or replace function get_reconcile_targets(
  p_sport_code   text,
  p_division     integer,
  p_season_id    bigint,
  p_recent_cutoff date,
  p_limit        integer
)
returns table (
  game_id              bigint,
  ncaa_contest_id      text,
  contest_date         date,
  home_team_season_id  bigint,
  away_team_season_id  bigint,
  missing_stats        boolean
)
language sql
stable
as $$
  select
    g.id,
    g.ncaa_contest_id,
    g.contest_date,
    g.home_team_season_id,
    g.away_team_season_id,
    not exists (select 1 from player_game_stats pgs where pgs.game_id = g.id) as missing_stats
  from games g
  where g.season_id  = p_season_id
    and g.sport_code = p_sport_code
    and g.division   = p_division
    and g.status     = 'final'
    and (
      g.contest_date >= p_recent_cutoff
      or not exists (select 1 from player_game_stats pgs where pgs.game_id = g.id)
    )
  order by (g.contest_date >= p_recent_cutoff) desc, g.contest_date desc
  limit p_limit;
$$;

grant execute on function get_reconcile_targets(text, integer, bigint, date, integer) to service_role;
