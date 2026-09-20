-- Read paths for the NCAA tournament bracket.
--
-- Both functions filter on `team_seasons.division_member` for BOTH sides, not just
-- `games.division`. The NCAA feed leaks other divisions' bracket games into the
-- division=1 response — 2024 MSO carried a 17th "First Round" game (New Haven vs
-- Concord, a DII contest) and 2023 WSO a 64th. Without the membership filter the
-- bracket grows a phantom game, and the release gate below can fire early off a
-- DII tournament that starts before the DI one.

-- Cheap existence check that gates the scoreboard's bracket link. Returns true
-- only when there is something for the bracket page to draw, which is what makes
-- "link visible => link not empty" true by construction rather than by guesswork.
create or replace function public.bracket_is_released(
	p_season_id  bigint,
	p_sport_code text,
	p_division   smallint default 1
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from games g
		join team_seasons hts on hts.id = g.home_team_season_id
		join team_seasons ats on ats.id = g.away_team_season_id
		where g.is_championship
		  and g.season_id  = p_season_id
		  and g.sport_code = p_sport_code
		  and g.division   = p_division
		  and hts.division_member
		  and ats.division_member
	);
$$;

-- Every bracket game for one season/sport, flattened for rendering. Ordering is by
-- round then date so the page can group without a second pass.
create or replace function public.get_bracket_games(
	p_season_id  bigint,
	p_sport_code text,
	p_division   smallint default 1
) returns table (
	game_id            bigint,
	round_description  text,
	round_order        int,
	contest_date       date,
	start_time         timestamptz,
	status             text,
	shootout           boolean,
	home_team_id       bigint,
	home_name          text,
	home_short_name    text,
	home_ncaa_team_id  text,
	home_logo_dark     text,
	home_logo_light    text,
	home_score         smallint,
	home_seed          smallint,
	home_won           boolean,
	away_team_id       bigint,
	away_name          text,
	away_short_name    text,
	away_ncaa_team_id  text,
	away_logo_dark     text,
	away_logo_light    text,
	away_score         smallint,
	away_seed          smallint,
	away_won           boolean
)
language sql
stable
security definer
set search_path = public
as $$
	select
		g.id,
		g.round_description,
		-- The feed's label vocabulary has been stable across every season and both
		-- sports (exactly these six), so a case expression beats a lookup table.
		case g.round_description
			when 'First Round'   then 1
			when 'Second Round'  then 2
			when 'Third Round'   then 3
			when 'Quarterfinals' then 4
			when 'Semifinals'    then 5
			when 'Championship'  then 6
			else 99
		end as round_order,
		g.contest_date,
		g.start_time,
		g.status,
		g.shootout,
		ht.id, ht.name, ht.short_name, ht.ncaa_team_id, ht.logo_url_dark, ht.logo_url_light,
		g.home_score, g.home_seed,
		-- A shootout keeps its tied score, so the advancing side is only knowable
		-- from shootout_winner_team_season_id — never from the score comparison.
		case
			when g.status <> 'final' then null
			when g.shootout then g.shootout_winner_team_season_id = g.home_team_season_id
			when g.home_score is null or g.away_score is null then null
			else g.home_score > g.away_score
		end as home_won,
		at.id, at.name, at.short_name, at.ncaa_team_id, at.logo_url_dark, at.logo_url_light,
		g.away_score, g.away_seed,
		case
			when g.status <> 'final' then null
			when g.shootout then g.shootout_winner_team_season_id = g.away_team_season_id
			when g.home_score is null or g.away_score is null then null
			else g.away_score > g.home_score
		end as away_won
	from games g
	join team_seasons hts on hts.id = g.home_team_season_id
	join team_seasons ats on ats.id = g.away_team_season_id
	join teams ht on ht.id = hts.team_id
	join teams at on at.id = ats.team_id
	where g.is_championship
	  and g.season_id  = p_season_id
	  and g.sport_code = p_sport_code
	  and g.division   = p_division
	  and hts.division_member
	  and ats.division_member
	order by round_order, g.contest_date, g.id;
$$;

grant execute on function public.bracket_is_released(bigint, text, smallint) to anon, authenticated, service_role;
grant execute on function public.get_bracket_games(bigint, text, smallint)   to anon, authenticated, service_role;
