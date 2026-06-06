# NCAA Men's Soccer – Scoreboard API Reference

**Page:** `https://www.ncaa.com/scoreboard/soccer-men/d1/2025/10/11/all-conf`  
**Documented:** June 6, 2026  
**Stack:** Drupal CMS (Bespin theme) + Preact frontend component  

---

## Infrastructure Overview

The page uses a **GraphQL API with Automatic Persisted Queries (APQ)**. Every request is a `GET` to the same base host with two query parameters that identify the query:

| Key | Value |
|---|---|
| `meta` | Human-readable query name (used for caching/routing) |
| `extensions` | URL-encoded JSON containing `persistedQuery.sha256Hash` |
| `variables` | URL-encoded JSON with runtime parameters |

### Hosts

| Alias | URL | Usage |
|---|---|---|
| **Read host (CDN)** | `https://sdataprod.ncaa.com` | All client-side data fetches (GET) |
| **Write host** | `https://sdata-ncaa-gql.prod.sdata-cloud.com` | Internal/mutations (not observed client-side) |

Both hosts are declared in `window.drupalSettings.core`:
```json
{
  "build": "master-9300",
  "isPROD": true,
  "gqlHost": "https://sdataprod.ncaa.com",
  "gqlHostRW": "https://sdata-ncaa-gql.prod.sdata-cloud.com"
}
```

---

## Men's Soccer Context Variables

These values are baked into `window.drupalSettings.scoreboard` at page render time and drive all query variables:

```json
{
  "sportCode": "MSO",
  "division": "d1",
  "seasonYear": 2025,
  "calendarYear": "2025",
  "sortByTop25": true,
  "currentDate": {
    "day": "11",
    "month": "10",
    "year": "2025",
    "month_name": "October",
    "next":     { "day": "11", "month": "11", "year": "2025" },
    "previous": { "day": "11", "month": "09", "year": "2025" }
  }
}
```

The scoreboard widget name for DI Men's Soccer is **`"DI M Soccer"`**.

---

## API Endpoints

### 1. `GetContests_web` ⭐ Primary Schedule/Score Loader

**Purpose:** Loads the list of game scores and schedules for a specific date. This is the core scoreboard data call — it fires on page load and again every time the user navigates to a different date.

**Trigger:** Initial page render + every date navigation click (`scoreboard-next` / `scoreboard-prev` buttons).

**Method:** `GET`  
**Base URL:** `https://sdataprod.ncaa.com`

**Full URL Pattern:**
```
https://sdataprod.ncaa.com
  ?meta=GetContests_web
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"4bcb5e6432fa9da365c0c19af01b1f9015cc7eb5c21e7af2dba308784a166df7"}}
  &queryName=GetContests_web
  &variables={"sportCode":"MSO","division":1,"seasonYear":2025,"contestDate":"10/11/2025","week":null}
```

**Persisted Query Hash:** `4bcb5e6432fa9da365c0c19af01b1f9015cc7eb5c21e7af2dba308784a166df7`

**Variables:**
| Variable | Type | Example | Notes |
|---|---|---|---|
| `sportCode` | string | `"MSO"` | Men's Soccer code |
| `division` | integer | `1` | 1 = D1, 2 = D2, 3 = D3 |
| `seasonYear` | integer | `2025` | NCAA season year |
| `contestDate` | string | `"10/11/2025"` | `MM/DD/YYYY` format |
| `week` | integer \| null | `null` | Week number, null for date-based lookup |

**Configured in:** `window.drupalSettings.scoreboard.contestsDataUrl`

---

### 2. `ScoringWidgetChampionship_ncaa` ⭐ Bracket / Championship Widget

**Purpose:** Loads championship bracket and tournament status data for the scoring widget displayed on the scoreboard page. Fires on page load and **polls on a ~5-second interval** continuously.

**Trigger:** Page load + continuous polling (observed ~30+ calls per minute).

**Method:** `GET`  
**Base URL:** `https://sdataprod.ncaa.com`

**Full URL Pattern:**
```
https://sdataprod.ncaa.com
  ?meta=ScoringWidgetChampionship_ncaa
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"833b812cd33218fbffa93fa81646e843d0b9bbca75283b2a33a0bf6d65ef9d27"}}
  &variables={"sportUrl":"soccer-men","division":1,"year":2025}
```

**Persisted Query Hash:** `833b812cd33218fbffa93fa81646e843d0b9bbca75283b2a33a0bf6d65ef9d27`

**Variables:**
| Variable | Type | Example | Notes |
|---|---|---|---|
| `sportUrl` | string | `"soccer-men"` | URL slug for the sport |
| `division` | integer | `1` | Division number |
| `year` | integer | `2025` | Season year |

**Configured in:** `window.drupalSettings.scoreboardWidget.shas.ScoringWidgetChampionship_ncaa`

---

### 3. `GetLiveSchedulePlusMmlEventVideo_web` ⭐ Live Schedule + Video Bar

**Purpose:** Drives the live game/video ticker bar at the top of the page (the horizontal scrolling "live now" strip). Fetches live games happening **today** across all NCAA sports and MML (March Madness Live) video events. Also **polls continuously** on a ~5-second interval.

**Trigger:** Page load + continuous polling.

**Method:** `GET`  
**Base URL:** `https://sdataprod.ncaa.com`

**Full URL Pattern:**
```
https://sdataprod.ncaa.com
  ?meta=GetLiveSchedulePlusMmlEventVideo_web
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"145b6f09ac69b0dc728c75f59a488c90b781e665fca89d60609e643614252a1f"}}
  &variables={"today":true,"monthly":false,"contestDate":"06/06/2026","seasonYear":2025,"current":true}
```

**Persisted Query Hash:** `145b6f09ac69b0dc728c75f59a488c90b781e665fca89d60609e643614252a1f`

**Variables:**
| Variable | Type | Example | Notes |
|---|---|---|---|
| `today` | boolean | `true` | Fetch today's live games |
| `monthly` | boolean | `false` | Monthly view toggle |
| `contestDate` | string | `"06/06/2026"` | Today's actual date (`MM/DD/YYYY`) |
| `seasonYear` | integer | `2025` | NCAA season year |
| `current` | boolean | `true` | Only current/live events |

**Configured in:** `window.drupalSettings.liveSchedule.graphqlDataUrl`

> **Note:** This query uses the **current real-world date** (today), not the scoreboard's selected date. Even when viewing historical scores, this always fetches what's live right now.

---

### 4. `NCAA_GetConferences_web` — Conference List (Configured, lazy-loaded)

**Purpose:** Fetches the list of conferences for the conference filter dropdown on the scoreboard. Loaded on demand when the user interacts with the conference filter, or SSR-embedded.

**Method:** `GET`  
**Base URL:** `https://sdataprod.ncaa.com`

**Full URL Pattern:**
```
https://sdataprod.ncaa.com
  ?meta=NCAA_GetConferences_web
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"6795d6b196a67ff7880cffab51e769a8784bc1646a9908276e0b787011df8c3f"}}
```

**Persisted Query Hash:** `6795d6b196a67ff7880cffab51e769a8784bc1646a9908276e0b787011df8c3f`

**Configured in:** `window.drupalSettings.scoreboard.conferencesDataUrl`

---

### 5. `NCAA_schedules_games_web` — Full Season Schedule (Configured, lazy-loaded)

**Purpose:** Fetches the full season schedule grid (the calendar/month view). Used when the user switches to a monthly schedule view rather than the day-by-day scoreboard.

**Method:** `GET`  
**Base URL:** `https://sdataprod.ncaa.com`

**Full URL Pattern:**
```
https://sdataprod.ncaa.com
  ?meta=NCAA_schedules_games_web
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"c653d0ac163b47bed513cd94aab887828c4ec7f4f9f698ea2bdcc574064e8d80"}}
```

**Persisted Query Hash:** `c653d0ac163b47bed513cd94aab887828c4ec7f4f9f698ea2bdcc574064e8d80`

**Configured in:** `window.drupalSettings.scoreboard.scheduleDataUrl`

---

## Request Lifecycle Summary

```
Browser loads page
↓
├── SSR HTML delivered (Drupal/Bespin)
│     └─ window.drupalSettings injected with all endpoint URLs + hashes
│
├── Preact component mounts (#preact-games-list-target)
│     │
│     ├──► GET GetContests_web          → scores/games for selected date
│     ├──► GET ScoringWidgetChampionship_ncaa  → tournament bracket
│     └──► GET GetLiveSchedulePlusMmlEventVideo_web  → live ticker
│
├── User clicks date nav (< or >)
│     └──► GET GetContests_web (new contestDate)
│
└── Polling timers (~5s interval, continuous)
      ├──► GET ScoringWidgetChampionship_ncaa
      └──► GET GetLiveSchedulePlusMmlEventVideo_web
```

---

## Supporting / Infrastructure Requests

These fire on every page load but do not carry men's soccer data:

| Domain | Purpose |
|---|---|
| `bam.nr-data.net` | New Relic browser monitoring (performance/errors) |
| `ping.chartbeat.net` | Chartbeat analytics (content analytics) |
| `www.google-analytics.com` | Google Analytics 4 (GA4) page view |
| `pixel.adsafeprotected.com` / `dt.adsafeprotected.com` | IAS (Integral Ad Science) ad viewability measurement |
| `pagead2.googlesyndication.com` | Google Ad Manager ad serving |
| `securepubads.g.doubleclick.net` | DoubleClick ad impression tracking |
| `prebid-a.rubiconproject.com` | Prebid.js header bidding (Magnite/Rubicon) |
| `api.btloader.com` | BT Loader (ad stack performance) |
| `events.bouncex.net` | Wunderkind (BounceX) behavioral retargeting |
| `aax.amazon-adsystem.com` | Amazon Publisher Services (TAM header bidding) |
| `68794912.akstat.io` | Akamai mPulse real user monitoring |
| `ep1.adtrafficquality.google` | Google Ad Traffic Quality / SODAR |

---

## Quick Reference — All 5 NCAA GraphQL Endpoints

| # | `meta` name | Hash (sha256) | Fires | Polling |
|---|---|---|---|---|
| 1 | `GetContests_web` | `4bcb5e64…166df7` | Page load + date nav | No |
| 2 | `ScoringWidgetChampionship_ncaa` | `833b812c…f9d27` | Page load | Yes (~5s) |
| 3 | `GetLiveSchedulePlusMmlEventVideo_web` | `145b6f09…252a1f` | Page load | Yes (~5s) |
| 4 | `NCAA_GetConferences_web` | `6795d6b1…f8c3f` | Lazy / on-demand | No |
| 5 | `NCAA_schedules_games_web` | `c653d0ac…e8d80` | Lazy / month view | No |
