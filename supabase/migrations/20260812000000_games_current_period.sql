-- Live period ("1ST HALF", "2ND HALF", "HALFTIME", "OT", …) for in-progress games.
--
-- The NCAA feed has always carried `currentPeriod` on every contest; the ingest
-- read it only to sniff /PK/ for shootout detection and then threw it away, so a
-- live card could say nothing more specific than "Live". `?mode=live` already
-- fetches this exact payload every minute, so persisting it costs no extra calls.
--
-- The sibling `contestClock` is deliberately NOT stored. It is elapsed time (it
-- counts up: 22:40 -> 23:10 across 50s of wall clock), it only refreshes on the
-- one-minute cron tick, and it advances slower than real time — a frozen clock
-- stale by up to a minute reads worse than no clock at all. The period alone is
-- coarse enough to survive that staleness.
--
-- Free-form text, not an enum: the values come from an external feed that is
-- free to invent new ones (OT variants, PK, weather suspensions), and a
-- constraint here would turn an unfamiliar string into a failed nightly ingest.

alter table public.games
	add column if not exists current_period text;

comment on column public.games.current_period is
	'NCAA feed currentPeriod for the game, as sent: "1ST HALF", "FINAL", "FINAL (OT)", "FINAL/PK". Empty feed values are stored as NULL. Only meaningful for display while status = live; final rows keep it as an OT/PK marker.';
