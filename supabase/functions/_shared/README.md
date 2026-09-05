# `_shared` — copies of pure `src/lib/server` modules for the Deno runtime

Deno edge functions cannot import `$lib`, so the roster functions each inline a
copy of the pure helpers they need. That worked for one pipeline; the webstream
pipeline needs the *same* parsers and matcher in **three** functions
(`schedule-discovery`, `stream-scrape`, `stream-ingest`), and inlining three
copies of a parser is three places for a fix to be forgotten.

Supabase bundles anything under `supabase/functions/`, so these functions import
from here instead.

| File | Source of truth |
|---|---|
| `carriers.ts` | `src/lib/server/carriers.ts` |
| `schedule.ts` | `src/lib/server/schedule.ts` |
| `schedule-html.ts` | `src/lib/server/schedule-html.ts` |
| `schedule-match.ts` | `src/lib/server/schedule-match.ts` |
| `roster-match.ts` | `src/lib/server/roster-match.ts` (for `normalizeName`) |
| `sidearm.ts` | `src/lib/server/sidearm.ts` (types only, for `roster-match`) |

**The `src/lib/server` copies are authoritative** — they are what the Vitest
suite covers (`src/lib/server/schedule.test.ts`). These are copies, refreshed by:

```bash
npm run sync:shared
```

The only permitted divergence is the `node-html-parser` import specifier, which
must be `npm:node-html-parser@…` for Deno; the sync script rewrites it. If you
edit a file here directly, the next sync will overwrite it.
