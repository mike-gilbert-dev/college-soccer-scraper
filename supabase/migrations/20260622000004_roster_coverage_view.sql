-- Roster project — Phase 7: coverage reporting view.
-- Per roster_source (team-season): how many player_seasons are roster-linked and
-- how complete their roster fields are, plus pending-review count. Drives the
-- admin coverage panel; failed-source counts come from roster_sources.status.

create or replace view roster_coverage as
select
  rs.id            as roster_source_id,
  rs.team_id,
  t.name           as team_name,
  t.ncaa_team_id,
  rs.season_id,
  rs.sport_code,
  rs.status,
  count(ps.id)                                              as player_seasons,
  count(ps.id) filter (where ps.roster_source_id = rs.id)  as roster_linked,
  count(ps.id) filter (where ps.class_year is not null)     as with_class,
  count(ps.id) filter (where ps.hometown is not null)       as with_hometown,
  count(ps.id) filter (where ps.headshot_path is not null)  as with_headshot,
  (select count(*) from roster_entry_queue q
     where q.roster_source_id = rs.id and q.review_status = 'pending') as pending_review
from roster_sources rs
join teams t on t.id = rs.team_id
left join team_seasons tsn
  on tsn.team_id = rs.team_id and tsn.season_id = rs.season_id and tsn.sport_code = rs.sport_code
left join player_seasons ps on ps.team_season_id = tsn.id
group by rs.id, rs.team_id, t.name, t.ncaa_team_id, rs.season_id, rs.sport_code, rs.status;

grant select on roster_coverage to authenticated, service_role;
