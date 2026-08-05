# Pick'em — Design Plan

Status: **built and shipped** (all 7 phases). This document is the *why* behind each decision;
`CLAUDE.md` documents the system as built, and [`docs/planning/pickem/`](planning/pickem) holds
the executed phase plans.

## What changed during the build

Six deviations from this plan, all deliberate:

1. **`handle_new_user` generates a fallback username instead of raising.** Rejecting a signup with
   no username would have broken registration in the window before the register form shipped, and
   would break any future OAuth/magic-link flow. It now falls back to a generated name.
2. **An extra grants migration.** Postgres grants `EXECUTE` to `PUBLIC` by default, so every helper
   function was reachable over PostgREST. Caught by the Supabase security advisor, not by this plan.
3. **`picks.division`** was added (denormalized like `sport_code`) so D2/D3 picks can never mix into
   D1 leaderboards if that data is ever ingested.
4. **`get_recent_picks()` was added.** This plan assumed the profile page could read `picks`
   directly — it can't. RLS restricts `picks` to their owner, so a direct read returns zero rows for
   anon and for anyone viewing someone else's profile.
5. **The win% qualifier counts *decided* picks (`w + l`), not graded-including-voids.** Otherwise 25
   cancelled games plus one real pick would qualify someone on a one-game sample.
6. **No combined "Overall" record.** Records are per season *and* per sport, full stop.

A logged-in user predicts the outcome of any D1 game that hasn't kicked off yet, directly from
the game card on [`/scores`](../src/routes/scores). Picks are graded automatically once the game
goes final. Each user gets a public profile showing their record and a season-long chart of their
performance against the field, and a site-wide leaderboard ranks users by total wins and by win %.

---

## Decisions made up front

| Decision | Choice | Why |
|---|---|---|
| **Draws** | 3-way pick: **Home / Draw / Away** | 2025 D1 finals were **22.3% draws (MSO)** and **21.5% (WSO)** — 1,149 of 5,276 games. Treating draws as a "push" would void ~1 pick in 5 and gut win% as a signal. Calling draws becomes a real skill. |
| **Scope** | D1 men's + women's, every game | Matches the pages users already browse. Leaderboards filter by sport so a men's-only picker isn't buried. |
| **Leaderboard** | Two boards — *Most Wins* (raw) and *Best Win %*, **25 graded picks** to qualify | Rewards both volume and accuracy; the qualifier is easy to explain, unlike a Wilson score. |
| **Usernames** | **Mandatory.** Unique (case-insensitive), 30-day change cooldown, 30-day reservation of the old name | Stable leaderboard identity; blocks immediate impersonation of an abandoned name. Mandatory so no public surface ever has to fall back to an email address. |
| **Non-D1 opponents** | Pickable, graded normally | D1 membership isn't known until later in the season, so filtering them out at pick time isn't possible anyway. |
| **Lock time** | Kickoff (`games.start_time`) | Verified: **0 of 5,279** D1 2025 games have a null `start_time`, so the fallback is a safety net, not a common path. |

### Draw rate — the number this design hinges on

```
sport  finals  ties   tie%   0-0 draws  shootouts
MSO     1931    430   22.3%     132        23
WSO     3345    719   21.5%     236        45
```

---

## Data model

Three new tables plus two columns on the existing `profiles`. All picks store an **outcome**,
never a team id — that keeps 2-way and 3-way modes a config difference rather than a migration,
and it sidesteps the `team_seasons` id churn that
[`20260609000001_split_team_seasons_by_sport.sql`](../supabase/migrations/20260609000001_split_team_seasons_by_sport.sql)
already caused once.

### 1. `profiles` — add username

```sql
alter table public.profiles
  add column username              text,
  add column username_changed_at   timestamptz,
  -- true = system-derived at backfill, never chosen by the user
  add column username_is_generated boolean not null default false;

-- Backfill existing accounts from the email local-part, then enforce NOT NULL.
update public.profiles p
   set username = lower(regexp_replace(split_part(u.email, '@', 1), '[^A-Za-z0-9_]', '', 'g')),
       username_is_generated = true
  from auth.users u
 where u.id = p.id and p.username is null;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$');

create unique index profiles_username_lower_idx on public.profiles (lower(username));
```

**Usernames are mandatory** — no public surface should ever have to fall back to an email address.

Verified against the live database: all 3 existing accounts derive to valid, non-colliding
usernames (11, 8 and 15 chars, all alphanumeric, all confirmed), so the backfill needs no
disambiguation suffix or length padding. *Re-check this if more accounts are created before the
migration runs* — the general case needs a collision suffix and a `lpad`/truncate for local-parts
outside 3–20 chars.

### Why `username_is_generated` exists

A derived username is a partial email disclosure — `kendallholliday` published on a leaderboard
strongly implies `kendallholliday@<provider>`. That's the exact exposure this feature is meant to
avoid, and a backfilled user hasn't agreed to it because they don't yet know the name exists.

So generated usernames are **private until confirmed**: a profile with
`username_is_generated = true` is excluded from `public_profiles`, the leaderboard and `/u/`, and
the user gets a one-time "this is your display name — keep it or change it" prompt at next login.
Confirming or changing it flips the flag to `false` and they appear normally. This costs one
boolean and one `where` clause, and it means no email-derived string is ever published to someone
who hasn't seen it first.

The prompt is also the natural place to explain the 30-day change cooldown — and confirming a
generated name does **not** start that cooldown, so a user isn't locked into a name they never
picked.

```sql
create table public.username_history (
  id          bigserial   primary key,
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  username    text        not null,
  released_at timestamptz not null default now()
);
create index username_history_lookup_idx on public.username_history (lower(username), released_at desc);
```

A released name is claimable again only after 30 days — except by its previous owner, who can
take it back immediately.

### 2. `picks`

```sql
create type pick_outcome as enum ('home', 'draw', 'away');
create type pick_result  as enum ('win', 'loss', 'void');

create table public.picks (
  id          bigserial    primary key,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  game_id     bigint       not null references public.games(id) on delete cascade,
  outcome     pick_outcome not null,

  -- denormalized from games; immutable for a given game, saves a join on every aggregate
  season_id   bigint       not null references public.seasons(id),
  sport_code  text         not null,

  result      pick_result,          -- null = not yet graded
  graded_at   timestamptz,

  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),

  unique (user_id, game_id)
);

create index picks_user_season_idx on public.picks (user_id, season_id, sport_code);
create index picks_game_idx        on public.picks (game_id);
-- drives the grader: only ungraded rows
create index picks_ungraded_idx    on public.picks (game_id) where result is null;
```

`season_id` / `sport_code` are filled by a `before insert` trigger that reads them off the game,
so the client can't lie about them and the leaderboard never has to join `games`.

**Why store `result` instead of computing it in a view.** A view is always correct after a score
correction and needs no job — genuinely tempting. But every leaderboard and profile read would
then join `picks → games` and re-apply the draw/shootout logic across the whole table. Storing a
graded column makes the leaderboard a plain `group by` on an indexed table, and makes the
cumulative timeline chart cheap. The correctness cost is handled by making the grader idempotent:
it re-grades any pick whose stored result disagrees with the current score, so a corrected score
self-heals on the next run.

### 3. Grading

```sql
create or replace function public.grade_picks() returns integer
language sql security definer set search_path = '' as $$
  with graded as (
    update public.picks p
       set result = case
             when g.status in ('cancelled','postponed') then 'void'::public.pick_result
             when (case
                     when g.home_score > g.away_score then 'home'
                     when g.away_score > g.home_score then 'away'
                     else 'draw'
                   end)::public.pick_outcome = p.outcome then 'win'::public.pick_result
             else 'loss'::public.pick_result
           end,
           graded_at = now()
      from public.games g
     where g.id = p.game_id
       and (g.status = 'final' and g.home_score is not null or g.status = 'cancelled')
       and p.result is distinct from ( /* same case expression */ )
    returning 1
  )
  select count(*)::int from graded;
$$;
```

- **Shootouts are draws.** A PK-decided game keeps a tied score, and the site already treats it as
  a tie in W-L-T records, RPI and Elo (see
  [`20260723000000_games_shootout.sql`](../supabase/migrations/20260723000000_games_shootout.sql)).
  Grading it any other way would contradict every other page. 68 of 5,276 games in 2025 — small,
  but worth being deliberate about. *If you'd rather have advancement decide a postseason pick,
  it's a one-branch change in the `case`.*
- **Cancelled → `void`.** Doesn't count for or against anyone.
- **Postponed → left ungraded.** The `games` row keeps its id and gets a new `contest_date`, so the
  pick simply grades whenever the game is actually played.
- **Idempotent.** `result is distinct from <computed>` means a re-run is a no-op unless a score
  changed.

**Schedule:** a pure-SQL pg_cron job — no edge function, no service key, no HTTP.

```sql
select cron.schedule('grade-picks', '*/10 * * * *', $$select public.grade_picks()$$);
```

Every 10 minutes self-gates to nothing when there's nothing to grade, so picks resolve within
minutes of a final rather than waiting for the 08:00 UTC nightly chain.

---

## Security model

This is the part most worth getting right, because the pick lock is a **fairness boundary** —
if it's only enforced in the UI, anyone with devtools can pick a game after it ends.

### Pick lock, enforced in RLS

```sql
alter table public.picks enable row level security;
grant select, insert, update, delete on public.picks to authenticated;

create or replace function public.game_is_open(p_game_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.games g
     where g.id = p_game_id
       and g.status = 'scheduled'
       and coalesce(g.start_time,
                    (g.contest_date::timestamp at time zone 'America/New_York')) > now()
  );
$$;

create policy "read own picks"   on public.picks for select to authenticated
  using (auth.uid() = user_id);

create policy "insert own picks" on public.picks for insert to authenticated
  with check (auth.uid() = user_id and public.game_is_open(game_id));

create policy "update own picks" on public.picks for update to authenticated
  using (auth.uid() = user_id and public.game_is_open(game_id))
  with check (auth.uid() = user_id and public.game_is_open(game_id));

create policy "delete own picks" on public.picks for delete to authenticated
  using (auth.uid() = user_id and public.game_is_open(game_id));
```

The `coalesce` fallback locks a TBD-time game at midnight ET on game day. No D1 2025 game needed
it, but D2/D3 or a future feed change might.

Note that users can only ever `select` **their own** picks. Everything aggregate — leaderboards,
other users' profiles, consensus percentages — goes through `security definer` functions that
expose only totals, never another user's individual unplayed pick.

### Username changes go through an RPC

`profiles` currently grants only `SELECT` to `authenticated`, which is right — we do **not** want
to hand out `UPDATE`, or a user could set `is_admin` or bypass the cooldown. Instead:

```sql
-- returns 'ok' | 'taken' | 'reserved' | 'invalid' | 'cooldown'
create function public.set_username(p_username text) returns text
language plpgsql security definer set search_path = '' as $$ ... $$;

create function public.username_available(p_username text) returns boolean ...;
```

`set_username` does format validation, reserved-word check, cooldown check, history insert and the
update in one transaction, so uniqueness can't be raced. `username_available` powers live
"✓ available" feedback on the register form.

Reserved words (blocklist, not exhaustive): `admin`, `administrator`, `moderator`, `mod`, `staff`,
`support`, `system`, `root`, `null`, `undefined`, `anonymous`, `deleted`, `collegesoccer`, `csio`,
`ncaa`.

### Public read surfaces

Per the project's standing gotcha, **views need their own explicit grants** — table grants don't
cascade. Every view and function below gets `grant select on ... to anon, authenticated` /
`grant execute on function ... to anon, authenticated`.

```sql
-- exposes username only; never is_admin, never email.
-- Generated (un-confirmed) usernames are withheld — see "Why username_is_generated exists".
create view public.public_profiles as
  select id, username from public.profiles where not username_is_generated;
grant select on public.public_profiles to anon, authenticated;
```

**Email is never rendered to anyone but its owner.** The navbar dropdown and mobile menu currently
print `page.data.user.email`; both switch to `@username`. That's the user's own address so it was
never a leak, but once usernames are mandatory there's no reason for an email to appear in the UI
at all.

Leaderboards and timelines are `security definer` **functions** rather than views, for three
reasons: they need parameters (season, sport, min-picks), they need explicit `limit`/`offset`
pagination (PostgREST caps responses at 1000 rows and truncates silently otherwise), and functions
don't trip Supabase's "view is SECURITY DEFINER" advisor lint.

```sql
get_leaderboard(p_season_id, p_sport_code, p_board, p_min_picks, p_limit, p_offset)
  -> rank, username, wins, losses, voids, graded, win_pct

get_user_pick_summary(p_username, p_season_id, p_sport_code)
  -> wins, losses, voids, graded, win_pct, rank, best_streak, current_streak

get_pick_timeline(p_username, p_season_id, p_sport_code)
  -> contest_date, user_wins, user_losses, user_cum_wins, user_cum_pct, field_cum_pct
```

**"Average" in the chart** = the **pooled field rate** (all users' wins ÷ all users' graded picks,
cumulative to that date), not the mean of per-user percentages. Pooled is far more stable early in
the season, when a handful of users with 2 picks each would otherwise swing the average wildly.

---

## Routes and UI

| Route | Access | Purpose |
|---|---|---|
| `/scores` *(existing)* | public; pick controls need auth | Pick controls on unstarted games; result badges on graded ones |
| `/pickem` | public | Leaderboard — season + sport tabs, two boards |
| `/u/[username]` | public, `noindex` | User profile: record, season chart, recent picks |
| `/account` | auth | Change username, email, password |
| `/api/picks` | auth | `POST` upsert / `DELETE` a pick |

Also: add **Pick'em** to [`Navbar.svelte`](../src/lib/components/Navbar.svelte) (desktop + mobile),
add **My Picks** and **Account** to the user dropdown, and add `/pickem` to
[`sitemap.xml`](../src/routes/sitemap.xml/+server.ts) per the project rule. Individual `/u/` pages
are deliberately excluded from the sitemap and marked `noindex` — user pages aren't search surface.

### The pick control on a game card

Scheduled games show no score, so the right-hand column of each team row is free — that's where
the pick control goes, keeping the card's existing two-row rhythm intact.

```
┌────────────────────────────────────┐   ┌────────────────────────────────────┐
│ BIG TEN                   7:00 PM  │   │ BIG TEN                     Final ✓│
│ ⚽ Indiana                 [ PICK ]│   │ ⚽ Indiana                       2 │
│ ────────── ( DRAW ) ────────────── │   │ ────────── your pick ──────────────│
│ ⚽ Maryland (H)           [ PICK ] │   │ ⚽ Maryland (H)                  1 │
└────────────────────────────────────┘   └────────────────────────────────────┘
        unstarted, no pick yet                  graded — pick was Indiana ✗
```

- Clicking a control picks that outcome; clicking the selected one clears it. Optimistic update,
  reverted on server error.
- The card body is already a `role="link"` that navigates to the box score, so every pick control
  needs `stopPropagation` — the same pattern the team links on that card already use.
- **`fetch` to `/api/picks`, not form actions.** A 100-game October Saturday would mean 300 `<form>`
  elements with `use:enhance`; a single endpoint plus local `$state` is far lighter, and the page
  already runs client-side JS for realtime scores.
- Logged out: the control renders as a muted "Sign in to pick" affordance linking to
  `/login?redirect=/scores`.

### Loading existing picks

[`/scores/+page.server.ts`](../src/routes/scores/+page.server.ts) gains one query after the games
load — `select game_id, outcome, result from picks where user_id = ... and game_id = any(...)` —
merged into the game list as `game.userPick`. One extra round trip, only for logged-in users.

**Realtime interaction:** the scoreboard already patches game rows live. When a game flips to
`final` in the browser, the card can derive the pick result client-side from the new score rather
than waiting up to 10 minutes for the grader — instant ✓/✗ feedback, with the stored result as the
authority on reload.

---

## Phases

Each phase is independently shippable.

**Phase 0 — Usernames.** Migration (columns, backfill, `NOT NULL`, index, history table, RPCs,
reserved list), update `handle_new_user` to read `raw_user_meta_data->>'username'`, add the
username field + live availability check to `/register`, build `/account`, add the
confirm-your-username prompt for backfilled accounts, and swap email → `@username` in the navbar.
*Everything else depends on this.*

**Phase 1 — Picks.** Migration (enums, `picks`, trigger, RLS, `game_is_open`), `/api/picks`,
the card control, loading existing picks into `/scores`.

**Phase 2 — Grading.** `grade_picks()`, the pg_cron job, result badges on cards, backfill grade of
any picks made before the job existed.

**Phase 3 — User profile.** `/u/[username]`, `get_user_pick_summary`, `get_pick_timeline`, and the
cumulative-vs-field SVG chart — built on the existing hand-rolled pattern in
[`PlayerFormChart.svelte`](../src/lib/components/PlayerFormChart.svelte), not a new charting dep.

**Phase 4 — Leaderboard.** `/pickem`, `get_leaderboard`, season/sport tabs, both boards, the
qualifier note for unqualified users.

**Phase 5 — Optional.** Pick consensus ("62% pick UNC" — needs a separate aggregate function so it
never leaks individual picks), weekly boards, conference filters, streak badges, PostHog events on
pick/change/clear.

---

## Open questions and known risks

1. **`NOT NULL` username breaks any signup path that doesn't supply one.** The `/register` form
   will, but a future OAuth or magic-link flow would fail at the trigger. When one is added,
   `handle_new_user` needs a fallback (generate a placeholder with
   `username_is_generated = true` and let the confirm prompt handle it) rather than raising.
2. **Abandoned signups squat usernames.** The name is claimed at `signUp`, before email
   confirmation. Acceptable for now; add an admin reaper for unconfirmed accounts older than N days
   if it becomes a problem.
3. **A failed unique-index hit at signup surfaces as a confusing Supabase error.** Mitigated by
   pre-checking with `username_available`, but there's a small race — the register action should
   catch `23505` and map it to a friendly "that username was just taken."
4. **Timeline chart cost** grows with users × dates. The per-date field average should be cached or
   materialized if `get_pick_timeline` gets slow; fine at current scale.
5. **Season rollover.** Leaderboards are per-season by design, so 2026 starts clean automatically.
   Decide later whether to surface an all-time board.
6. **The 25-pick qualifier is a starting guess**, not a derived number. Revisit once there's real
   usage — if most active users land at 60+ graded picks, 25 is too permissive.
