-- Add headshot_path to the player_season_stats view so roster/player UIs can show
-- headshots without a separate query. Appended at the end (CREATE OR REPLACE VIEW
-- requires existing columns unchanged + new ones last).
create or replace view player_season_stats as
 select ps.id as player_season_id,
    ps.player_id,
    p.ncaa_player_id,
    p.name as player_name,
    ps.team_season_id,
    ps.jersey_number,
    ps.position,
    ps.class_year,
    count(distinct pgs.game_id) as games_played,
    coalesce(sum(pgs.minutes_played), 0::bigint) as minutes_played,
    coalesce(sum(pgs.goals), 0::bigint) as goals,
    coalesce(sum(pgs.assists), 0::bigint) as assists,
    coalesce(sum(pgs.goals), 0::bigint) + coalesce(sum(pgs.assists), 0::bigint) as points,
    coalesce(sum(pgs.shots), 0::bigint) as shots,
    coalesce(sum(pgs.shots_on_goal), 0::bigint) as shots_on_goal,
    coalesce(sum(pgs.fouls_committed), 0::bigint) as fouls,
    coalesce(sum(pgs.yellow_cards), 0::bigint) as yellow_cards,
    coalesce(sum(pgs.red_cards), 0::bigint) as red_cards,
    coalesce(sum(pgs.green_cards), 0::bigint) as green_cards,
    coalesce(sum(pgs.penalty_shot_goals), 0::bigint) as penalty_shot_goals,
    coalesce(sum(pgs.penalty_shot_attempts), 0::bigint) as penalty_shot_attempts,
    sum(pgs.gk_saves) as gk_saves,
    sum(pgs.gk_goals_against) as gk_goals_against,
    coalesce(sum(case when pgs.gk_shutout then 1 else 0 end), 0::bigint) as gk_shutouts,
    ps.headshot_path
   from player_seasons ps
     join players p on p.id = ps.player_id
     left join player_game_stats pgs on pgs.player_season_id = ps.id
  group by ps.id, ps.player_id, p.ncaa_player_id, p.name, ps.team_season_id, ps.jersey_number, ps.position, ps.class_year, ps.headshot_path;
