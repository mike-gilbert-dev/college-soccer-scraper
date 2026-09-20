-- NCAA championship-bracket markers on games.
--
-- `round_description` alone cannot identify the NCAA tournament. In 2023 the feed
-- also labelled *conference* tournament games (with unusable labels like
-- "All Rounds" / "Semifinals, Final" that never name the conference), so gating a
-- bracket on `round_description <> ''` renders a 2023 "NCAA bracket" built out of
-- NEC quarterfinals. `is_championship` is the only clean separator the feed gives.
--
-- From 2024 on the feed stopped labelling conference tournaments entirely
-- (isChampionship=false, roundDescription='', seed=null on every one of them), so
-- conference brackets are simply not derivable from this source. NCAA-only is not
-- a scoping choice, it is the limit of the data.

alter table public.games
	add column if not exists is_championship boolean not null default false,
	add column if not exists home_seed smallint,
	add column if not exists away_seed smallint;

comment on column public.games.is_championship is
	'NCAA championship-bracket game (feed isChampionship). False for conference tournaments — the feed does not flag those.';
comment on column public.games.home_seed is
	'NCAA tournament seed 1-16 for the home side; NULL for unseeded teams and all non-bracket games.';
comment on column public.games.away_seed is
	'NCAA tournament seed 1-16 for the away side; NULL for unseeded teams and all non-bracket games.';

-- Supports the "has the bracket been released?" existence check that gates the
-- scoreboard's bracket link, and the bracket page's own round fetch. Partial, so
-- it stays tiny: ~50 rows per season/sport out of 20k+ games.
create index if not exists games_championship_idx
	on public.games (season_id, sport_code, division, contest_date)
	where is_championship;
