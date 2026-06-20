<wizard-report>
# PostHog post-wizard report

The wizard has completed a full PostHog integration for CollegeSoccer.IO. Here's a summary of everything added:

- **Client-side initialization** — `src/hooks.client.ts` (new): initializes `posthog-js` via the SvelteKit `init()` hook with a reverse-proxy `api_host`, and wires `captureException` into the client `handleError` hook for automatic error tracking.
- **Server-side singleton** — `src/lib/server/posthog.ts` (new): a lazy-initialized `posthog-node` client used for server-side error events.
- **Reverse proxy** — `src/hooks.server.ts` (updated): `/ingest/*` requests are proxied to `us.i.posthog.com` (and `/ingest/static/*` + `/ingest/array/*` to `us-assets.i.posthog.com`) to avoid ad-blockers. A `handleError` export sends `server_error` events to PostHog with status code and message.
- **User identification** — `src/routes/+layout.svelte` (updated): on mount, if a user session already exists, `posthog.identify()` is called immediately. The Supabase `onAuthStateChange` listener now also calls `identify()` on `SIGNED_IN` and `reset()` on `SIGNED_OUT`.
- **Session replay fix** — `svelte.config.js` (updated): `paths.relative: false` added to the kit config, which is required for PostHog session replay to work correctly under SSR.
- **Auth events** — `src/routes/login/+page.svelte` and `src/routes/register/+page.svelte` (updated): SvelteKit `enhance` callbacks now capture `user_signed_in` and `user_registered` events on successful form action results.
- **Content page events** — 5 pages updated with `onMount`-based `posthog.capture()` calls (team, game, player, ratings, stats pages) plus interaction events for tab switches, season changes, and rating system changes.

| Event | Description | File |
|---|---|---|
| `user_signed_in` | User successfully completed login with email and password. | `src/routes/login/+page.svelte` |
| `user_registered` | User successfully created a new account. | `src/routes/register/+page.svelte` |
| `team_viewed` | User opened a team's schedule and roster page. | `src/routes/teams/[ncaa_team_id]/+page.svelte` |
| `team_tab_switched` | User switched between the Schedule and Roster tabs on a team page. | `src/routes/teams/[ncaa_team_id]/+page.svelte` |
| `team_season_changed` | User selected a different season from the season dropdown on a team page. | `src/routes/teams/[ncaa_team_id]/+page.svelte` |
| `game_viewed` | User opened a game boxscore page to view match stats. | `src/routes/games/[ncaa_contest_id]/+page.svelte` |
| `player_viewed` | User opened a player's career stats and game log page. | `src/routes/players/[ncaa_player_id]/+page.svelte` |
| `ratings_viewed` | User viewed the team power ratings leaderboard. | `src/routes/ratings/+page.svelte` |
| `rating_system_changed` | User switched between ELO, RPI, or Power rating systems on the ratings page. | `src/routes/ratings/+page.svelte` |
| `stats_viewed` | User viewed the statistical leaders page. | `src/routes/stats/+page.svelte` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard** — [Analytics basics (wizard)](https://us.posthog.com/project/478762/dashboard/1738861)
- **Insight 1** — [User Sign-ins & Registrations](https://us.posthog.com/project/478762/insights/i0oMPrsE)
- **Insight 2** — [Content Views by Type](https://us.posthog.com/project/478762/insights/HUUxH4vE)
- **Insight 3** — [Registration to Sign-in Funnel](https://us.posthog.com/project/478762/insights/zaM5KNPO)
- **Insight 4** — [Unique Active Users (Content)](https://us.posthog.com/project/478762/insights/7a9iissK)
- **Insight 5** — [Ratings & Stats Exploration](https://us.posthog.com/project/478762/insights/20dxEFOF)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to `.env.example` and any onboarding/bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — the layout calls `identify` on mount if `data.user` is set (covering SSR-rendered sessions), but verify this with an actual returning-user login flow in staging.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
</wizard-report>
