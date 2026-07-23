-- Penalty-kick shootout support.
--
-- The NCAA feed returns tied regulation/OT `score` for a postseason game decided
-- by penalty kicks, but still flags the advancing team via `isWinner`. We were
-- dropping that signal, so shootout games looked like plain ties everywhere.
--
-- Per official NCAA convention a PK game is STILL a tie in a team's W-L-T record
-- and in the NCAA RPI — the shootout only decides who advances. So we keep the
-- tied score (records + Elo/RPI unchanged) and only record that a shootout
-- happened and which side advanced, for display purposes.

alter table public.games
	add column if not exists shootout boolean not null default false,
	add column if not exists shootout_winner_team_season_id bigint
		references public.team_seasons(id);

comment on column public.games.shootout is
	'Game decided by a penalty-kick shootout (postseason). Per NCAA convention the game stays a tie in W-L-T records and RPI/Elo; this only records that a shootout occurred.';
comment on column public.games.shootout_winner_team_season_id is
	'team_seasons.id of the side that won the shootout and advanced. Null unless shootout is true.';
