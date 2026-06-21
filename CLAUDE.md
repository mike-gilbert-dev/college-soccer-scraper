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
- **Player stats:** not in the nightly run. Pull on demand via the admin "Ingest Archives" UI (which shares [`src/lib/server/ingest.ts`](src/lib/server/ingest.ts)).

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
