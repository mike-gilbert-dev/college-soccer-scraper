# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server
npm run build        # production build
npm run preview      # preview production build
npm run check        # type-check with svelte-check
npm run check:watch  # type-check in watch mode
```

There is no test suite yet.

## Architecture

SvelteKit 2 app using Svelte 5 with **runes mode enforced** (configured in `svelte.config.js` — all files outside `node_modules` must use the `$props()`, `$state()`, `$derived()` etc. rune syntax, not the legacy `export let` / reactive store style).

### Auth flow (Supabase SSR)

Session management is server-authoritative:

- `src/hooks.server.ts` — runs on every request; attaches `locals.supabase` (a server-side Supabase client) and `locals.safeGetSession()`, which validates the JWT via `getUser()` rather than trusting the cookie alone.
- `src/routes/+layout.server.ts` — calls `safeGetSession()` and exposes `session` and `user` to all pages via `PageData`. Uses `depends('supabase:auth')` so the layout re-runs when auth state changes.
- `src/routes/+layout.svelte` — creates the browser-side Supabase client and calls `invalidate('supabase:auth')` on `SIGNED_IN`, `SIGNED_OUT`, and `TOKEN_REFRESHED` events to keep the server session in sync.
- `src/lib/supabase.ts` — factory functions for both clients (`createSupabaseBrowserClient`, `createSupabaseServerClient`). The browser client is safe to create per-component; the server client is created per-request via hooks.

Auth routes: `/login`, `/register`, `/logout`. Login and register use SvelteKit form actions (no client-side JS required). The logout route has only a `+page.server.ts` with a form action.

### Environment variables

Required in `.env` (gitignored; see `.env.example`):

```
PUBLIC_SUPABASE_URL=         # Project URL from Supabase dashboard → Settings → API
PUBLIC_SUPABASE_PUBLISHABLE_KEY=  # Publishable key (sb_publishable_...) — safe for client use
```

Supabase uses publishable/secret keys (not the legacy anon/service_role naming). Use the publishable key everywhere in this app; a secret key would only be needed for admin-level server operations.

### Path aliases

`$lib` → `src/lib` (SvelteKit default). No custom aliases configured.

## Component Library

Flowbite Svelte is used for UI components (tables, icons, etc.). Usage patterns, import conventions, and known quirks are documented in [`docs/flowbite-svelte.md`](docs/flowbite-svelte.md).

## Design

The target UI is a dense, sports-results–style interface with light/dark themes. Full design system spec (colors, typography, layout, components, spacing) is in [`docs/design.md`](docs/design.md). Accent color is `#e8463a` (red), used consistently across both themes.

## SEO

When adding or removing a route, update [`src/routes/sitemap.xml/+server.ts`](src/routes/sitemap.xml/+server.ts) to reflect the change. Static pages are hardcoded in the `staticUrls` array; dynamic pages (teams, games) are queried from the database. Auth pages (`/login`, `/register`, etc.) and internal routes (`/admin`, `/api/`) should not be included.

## Data Source

The app scrapes the NCAA Men's Soccer scoreboard via its internal GraphQL API (Automatic Persisted Queries). Full endpoint documentation — including hashes, variables, and the request lifecycle — is in [`docs/ncaa-mens-soccer-api-endpoints.md`](docs/ncaa-mens-soccer-api-endpoints.md).

Key points:
- All reads go to `https://sdataprod.ncaa.com` via GET requests
- The primary endpoint is `GetContests_web` (sport code `MSO`, division `1`)
- `contestDate` is formatted `MM/DD/YYYY`
- No authentication required for any of the 5 endpoints

`GetContests_web` returns **every contest for a date regardless of state** (`scheduled` / `live` / `final` / `cancelled`), so schedules and final scores come from the same call — the pipeline only differs by the game's `status`.

## Nightly scores ingest (Supabase Edge Function + pg_cron)

The unattended nightly **scores** pipeline runs on Supabase, not Vercel. Vercel's
Hobby 60s function limit couldn't absorb a big slate because the SvelteKit ingest
does ~6–8 sequential DB round-trips per game; an October Saturday (100+ games)
timed out. The edge function fixes the root cause with **batched bulk upserts**
(~4 calls per date) — the same Saturday now ingests in ~1.4s.

- **Edge function:** [`supabase/functions/nightly-ingest/index.ts`](supabase/functions/nightly-ingest/index.ts). Fetches `GetContests_web`, archives raw JSON to the `ncaa-raw-games` bucket, then bulk-upserts conferences → teams → team_seasons → games. Scores-only (no box scores / player stats). Deployed with `verify_jwt: false`; it auth-checks `Authorization: Bearer <service role key>` itself.
- **Schedule:** pg_cron job `nightly-ingest` at `0 8 * * *` UTC, calling the function via `pg_net`. Migrations: [`20260621000000_enable_cron_and_net.sql`](supabase/migrations/20260621000000_enable_cron_and_net.sql), [`20260621000001_schedule_nightly_ingest.sql`](supabase/migrations/20260621000001_schedule_nightly_ingest.sql). The service-role key lives in **Vault** (secret `edge_service_key`), created out-of-band — never committed.
- **Season:** the function resolves the `seasons` row covering today (or a forced `?date=`) and **no-ops in the off-season**, so the job is safe year-round.
- **Targets / knobs:** `DEFAULT_TARGETS` = MSO + WSO D1, 2-day window. Query overrides: `?days=`, `?date=YYYY-MM-DD` (anchors season resolution for backfills), `?sport=&division=`.
- **Manual trigger:** `curl -H "Authorization: Bearer <service_role_key>" "https://<project>.supabase.co/functions/v1/nightly-ingest?date=2025-10-11"`
- **Player stats:** handled by the separate nightly-reconcile pass (below), not this function.

### Live in-game scores (`?mode=live`)
The same edge function serves a **live** mode for in-game score updates, reusing the
exact bulk-upsert path (no duplicate scraper). Differences from the nightly run:
- **Today only**, and it **self-gates**: before any NCAA call it counts games this
  season with `start_time` in `[now − 3h, now + 15m]` (in-progress / just-finished /
  imminent). Zero matches → `{ran:false, reason:'no games in play window'}`, no fetch.
  The gate is keyed purely on `start_time`, so it auto-wakes for any slate and
  auto-sleeps afterward — no game-day babysitting, no calendar.
- **Skips the Storage archive and per-run success `scrape_log`** (error logging stays).
  The nightly run still captures the canonical end-of-day archive; reconcile + ratings
  still finalize overnight. Live = scores only.
- **Schedule:** pg_cron job `nightly-ingest-live` at `* * * * *` (every minute).
  Migration: [`20260628000000_schedule_nightly_ingest_live.sql`](supabase/migrations/20260628000000_schedule_nightly_ingest_live.sql).
  Same Vault secret and off-season no-op as the nightly ingest, so it's safe year-round.
- **Manual:** `curl -H "Authorization: Bearer <service_role_key>" "https://<project>.supabase.co/functions/v1/nightly-ingest?mode=live"`

#### Live delivery to the browser (Supabase Realtime)
The scoreboard ([`src/routes/+page.svelte`](src/routes/+page.svelte)) pushes these live
updates to clients instead of waiting for a reload:
- `games` is in the `supabase_realtime` publication (migration
  [`20260628000001_games_realtime.sql`](supabase/migrations/20260628000001_games_realtime.sql));
  Realtime respects the existing "public read games" RLS policy, so anonymous visitors receive rows.
- The page holds the SSR game list in a local `$state` (seeded from `data.games` so there's no
  hydration flash; re-seeded on date/sport/season nav) and subscribes to `postgres_changes`
  (UPDATE on `games`), patching the matching row by `id`. Updates for games on other dates don't
  match and are ignored — no server-side filter needed.
- **Live games don't link into the box score.** Player stats aren't scraped until the overnight
  reconcile (one NCAA call *per game* — too expensive to poll live), so a live game's box score
  would be empty. Live cards render as plain (non-link) elements; final/scheduled cards link as before.

## Nightly reconcile / player stats (Supabase Edge Function + pg_cron)

[`supabase/functions/nightly-reconcile/index.ts`](supabase/functions/nightly-reconcile/index.ts) runs at `08:05 UTC` (5 min after ingest) and is the **player-stats automation + accuracy pass**. Per target it:
1. Selects box-score targets via [`get_reconcile_targets`](supabase/migrations/20260621000003_reconciliation_log_and_targets.sql) — recently-final games (catch corrections / new) **or** any season final still missing `player_game_stats` (gap fill), recent-first, capped (`?cap=`, default 200).
2. Fetches each box score (bounded concurrency, `?concurrency=`, default 8), archives raw JSON to the `boxscores/` Storage path, and **batch-upserts** players → player_seasons → player_game_stats.
3. Writes a `reconciliation_log` row incl. season-wide finals-missing-stats **before/after** (computed via `get_games_missing_player_stats`), surfaced in `/admin` → Data → **Reconciliation**.

- **Bounded:** ≤`cap` box scores per run, so a large initial backfill self-heals over successive nights (`capped` flag signals a residual). Player stats are not part of nightly-ingest by design (box-score fetch is one NCAA call per game).
- **Player names are never overwritten.** Both this function and [`ingest.ts`](src/lib/server/ingest.ts) create players via the [`get_or_create_players`](supabase/migrations/20260621000005_get_or_create_players.sql) RPC (`insert ... on conflict do nothing`), so externally-normalized `players.name` formatting survives every run. New players arrive with the raw NCAA name — re-run name normalization periodically to catch newcomers, but it never has to *undo* a clobber. (Jersey number / position on `player_seasons` are still kept current.)
- **Forced run / backfill:** `?date=YYYY-MM-DD` reconciles *all* finals on that date (any sport via `?sport=&division=`). Manual: `curl -H "Authorization: Bearer <service_role_key>" "https://<project>.supabase.co/functions/v1/nightly-reconcile?date=2025-10-11&sport=MSO&division=1"`
- **Schedule migration:** [`20260621000004_schedule_nightly_reconcile.sql`](supabase/migrations/20260621000004_schedule_nightly_reconcile.sql). Same Vault secret (`edge_service_key`) as nightly-ingest.

## Nightly ratings recompute (pg_cron → Vercel)

A second pg_cron job `nightly-ratings` runs at `08:15 UTC` — 15 min after the
ingest — and recomputes Elo/RPI/Power. Recompute is *non-chatty* (bulk reads,
chunked writes; ~4s for both sports) so it fits Vercel's 60s budget, and reusing
the Vercel endpoint avoids a duplicate rating engine in Deno.

- The job calls [`src/routes/api/cron/nightly/+server.ts`](src/routes/api/cron/nightly/+server.ts) with `?phase=ratings` (skips ingest, recomputes for `DEFAULT_TARGETS`). Migration: [`20260621000002_schedule_nightly_ratings.sql`](supabase/migrations/20260621000002_schedule_nightly_ratings.sql).
- **Auth:** `Authorization: Bearer $CRON_SECRET` ([`src/lib/server/cron-auth.ts`](src/lib/server/cron-auth.ts)); the secret is in Vault (`vercel_cron_secret`) for pg_net and in Vercel's env for the endpoint.
- `?phase` on that route: `both` (default) | `ingest` (skip ratings) | `ratings` (skip ingest).

### Retired: Vercel cron schedule
The Vercel cron in [`src/routes/api/cron/nightly/+server.ts`](src/routes/api/cron/nightly/+server.ts) was the first cut at the *ingest*. Its schedule is removed (`vercel.json` `crons: []`) because the chatty ingest exceeded Hobby's 60s — that moved to the Supabase edge function. The route itself still serves `?phase=ratings` (used above) and works as a manual ingest fallback over a narrow window.

## Roster pipeline (headshots, class year, hometown + player matching)

Collects player roster data (headshot, class year, height, hometown, position, jersey)
from external NCAA team athletics sites (Sidearm Sports JSON API) and connects those
external players to internal `player_seasons`. Built as **three separate on-demand
edge functions** (no cron — rosters change rarely; invoke manually). Each authenticates
with `Authorization: Bearer <service role key>` and is deployed `verify_jwt:false`.

Pipeline (run in order):
1. **`roster-scrape`** — fetch `https://{domain}/api/v2/Rosters/{id}` and archive raw JSON
   to the `sidearm-raw-rosters` bucket (source of truth). No DB writes to player tables.
2. **`roster-ingest`** — read the archived JSON back from Storage (no external fetch),
   parse, match each entry to the team-season's existing `player_seasons` by normalized
   name (+ jersey confirmer), **enrich** confident matches (headshot_url/height/hometown/
   class_year; fill-null jersey/position; never clobbers `players.name`), and **stage**
   unmatched/ambiguous in `roster_entry_queue` for review.
3. **`roster-headshots`** — the only step that downloads images. For matched players with a
   new/changed `headshot_url`, download the image to the public `player-headshots` bucket
   at `MSO/<seasonYear>/<division>/<teamId>/<playerId>.<ext>` and set `player_seasons.headshot_path`.
   Idempotent (skips unchanged via `headshot_downloaded_from`); `?force=true` re-downloads.

Targeting on all three: `?source=<id>` | `?team=<ncaa_team_id>` | default = all
`roster_sources.status='verified'`. Season is resolved from the `roster_sources` row
(not "today"), so it works year-round. Manual example:
`curl -H "Authorization: Bearer <service_role_key>" "https://<project>.supabase.co/functions/v1/roster-scrape?team=north-carolina-st"`

### Source discovery
- `roster_sources` maps `(team_id, sport_code, season_id)` -> external `domain` + `sidearm_roster_id` + `status`.
- Bootstrap domains via `scripts/import-roster-sources.mjs` (imports `supabase/seed-data/roster_urls_2025.json`, matching keys to teams by `ncaa_team_id` or slugified name).
- **`roster-discovery`** resolves each `sidearm_roster_id` from the Sidearm list endpoint
  (`/api/v2/Rosters/list?sport=msoc`, matching `seasonTitle` to the season's year) and verifies
  by fetching the roster (sane player count). Sets `status='verified'|'failed'`. Knobs: `?limit`, `?concurrency`, `?source`, `?team`, `?force`.
- **Three platforms.** `roster-discovery` tries the NextGen JSON list endpoint first
  (`platform='sidearm'`); if absent it falls back to fetching the roster page and counting
  `.sidearm-roster-player` card links (the **older ASP.NET/Knockout Sidearm**, `platform='sidearm-html'`).
  Both verify to `status='verified'`. The third is **WMT Digital** (`platform='wmt'`) — a Nuxt SPA
  used by many big programs (Stanford, Virginia, Clemson, Penn St, Va Tech, SDSU, UCF, ODU, SJSU,
  Seattle). Discovery does *not* auto-detect WMT; set `platform='wmt'` manually then run the pipeline.
  Truly non-Sidearm/WMT or dead domains end `failed` (manual tail — see source `notes`).
- **Sidearm sport-slug gotcha.** The NextGen list endpoint's `?sport=` param varies per site:
  `msoc` (most), `msoccer`, or `mens-soccer` (e.g. Syracuse/cuse.com only answers `msoccer`).
  Discovery uses `msoc`; sites that only answer another slug land in the failed tail until their
  `sidearm_roster_id` is set manually.
- **WMT specifics.** WMT roster pages server-render their data into a single
  `<script id="__NUXT_DATA__">` block as a **devalue flat array** (object property values are
  integer indices into the same array). `src/lib/server/wmt.ts` (`parseWmtRoster`, inlined into
  roster-ingest) resolves that graph. Two traps: (1) the *live default* roster is the **upcoming**
  season — request `/sports/{slug}/roster/season/{year}` to pin a past season (roster-scrape's
  `buildWmtRosterUrls` tries season paths, both `mens-soccer`+`msoc` slugs, then the default, and
  archives whichever yields the most players); (2) some WMT sites (South Carolina, Kentucky) are
  pure SPAs with **no SSR data** (XHR-only) and can't be scraped from HTML. Headshots are
  full-resolution absolute imgproxy URLs (no `?width=` param).
- **Platform-aware scrape/ingest.** `roster-scrape` archives `.json` (sidearm) or `.html`
  (sidearm-html, wmt); `roster-ingest` parses with `parseRoster` (JSON), `parseSidearmHtmlRoster`
  (HTML cards, `src/lib/server/sidearm-html.ts`), or `parseWmtRoster` (`src/lib/server/wmt.ts`) —
  all via `node-html-parser`, inlined in the edge fns. `roster-headshots` is platform-agnostic and
  strips `?width=` thumbnail params to fetch full-resolution old-Sidearm images.

### Admin surfaces
- [`/admin/roster`](src/routes/admin/roster) — review queue: approve→link (enrich an existing
  player_season), approve→create (mint a new player — **avoid for in-progress seasons**, see
  duplicate caveat), reject; plus run history + coverage summary.
- [`/admin/roster/sources`](src/routes/admin/roster/sources) — manage `roster_sources`: status
  filter, manual domain/roster-id/status edit, per-row Re-verify, and per-team + overall coverage
  (backed by the `roster_coverage` view).

### Resolution RPCs
`roster_queue_reject`, `roster_queue_approve_link`, `roster_queue_approve_create` — players are
created **only** on explicit human approval, never by the matcher.

### Duplicate-player caveat
`approve_create` mints a player with a roster-origin synthetic `ncaa_player_id` (`rs{source}_{name}`),
which does NOT share a namespace with box-score players (`{ncaaTeamId}_{name}`). If such a player
later appears in a box score, `nightly-reconcile` creates a *separate* player + player_season ->
duplicate. Safe for completed seasons (box scores final); risky as a preseason bootstrap. Prefer
**link-only** until a merge tool exists.

## News / Articles

Editorial news section. **News is the homepage (`/`)**; the scoreboard moved to
[`/scores`](src/routes/scores). Featured article = **most recent published** (no manual pin);
the homepage shows featured + 4 streamlined cards, then a "Load more" button fetches 8 at a time
via [`/api/news`](src/routes/api/news/+server.ts). Article detail pages live at
[`/news/[slug]`](src/routes/news/[slug]).

- **Schema** ([`20260719000000_articles.sql`](supabase/migrations/20260719000000_articles.sql)):
  `articles` (slug unique, title, subtitle/dek, free-form `category`, `body_markdown`, hero image
  path+url, `status` in `draft|published`, editable `published_at`, `updated_at` trigger) plus
  `article_teams` / `article_players` join tables (FK the bigserial `teams.id` / `players.id`).
  **Draft privacy is an RLS boundary:** the public policy exposes only `status='published'`; anon
  reads (browser publishable-key client / `locals.supabase`) can never see drafts.
- **Images** live in the public **`article-images`** bucket
  ([`20260719000001`](supabase/migrations/20260719000001_article_images_bucket.sql)); uploaded via
  the admin-gated [`/api/admin/news/upload`](src/routes/api/admin/news/upload/+server.ts) endpoint
  (hero + inline body images). Replacing a hero best-effort deletes the old object.
- **Data layer:** [`src/lib/server/articles.ts`](src/lib/server/articles.ts) — public reads take
  `locals.supabase` (RLS); admin reads/writes use `supabaseAdmin` (service_role). Card lists select
  card columns only (never `body_markdown`); list query uses the partial `articles_published_idx`.
- **Markdown:** [`src/lib/server/markdown.ts`](src/lib/server/markdown.ts) `renderMarkdown()` (marked
  + sanitize-html) is the **only** place body Markdown becomes HTML — used by both the detail page
  and the editor's live-preview endpoint, so preview === final render. `.article-body` styles in
  `app.css` (no typography-plugin dependency).
- **Admin** ([`/admin/news`](src/routes/admin/news)): list (all statuses) + create/edit editor
  (`ArticleEditor.svelte`) with Markdown + live preview, hero/inline upload, team/player tagging
  pickers, draft/publish toggle. Admin API is gated by `'/api/admin'` in `hooks.server.ts`
  `ADMIN_PATHS`. **Draft = work without displaying it**; an admin can preview a draft at its real
  `/news/[slug]` URL (DRAFT banner + `noindex`); non-admins get a 404.
- **SEO:** published articles are added to
  [`sitemap.xml`](src/routes/sitemap.xml/+server.ts) (drafts excluded); detail pages emit OG/article
  meta tags. `/scores` is also in the sitemap.
