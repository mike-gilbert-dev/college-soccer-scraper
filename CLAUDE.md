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

## Design

The target UI is a dense, sports-results–style interface with light/dark themes. Full design system spec (colors, typography, layout, components, spacing) is in [`docs/design.md`](docs/design.md). Accent color is `#e8463a` (red), used consistently across both themes.

## Data Source

The app scrapes the NCAA Men's Soccer scoreboard via its internal GraphQL API (Automatic Persisted Queries). Full endpoint documentation — including hashes, variables, and the request lifecycle — is in [`docs/ncaa-mens-soccer-api-endpoints.md`](docs/ncaa-mens-soccer-api-endpoints.md).

Key points:
- All reads go to `https://sdataprod.ncaa.com` via GET requests
- The primary endpoint is `GetContests_web` (sport code `MSO`, division `1`)
- `contestDate` is formatted `MM/DD/YYYY`
- No authentication required for any of the 5 endpoints
