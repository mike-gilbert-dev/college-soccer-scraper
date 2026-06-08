# Scraper Flow Diagrams

## Historic Backfill

```mermaid
flowchart TD
    subgraph BF_INPUTS["Historic Backfill — Inputs"]
        I_DATE["Start / End Date"]
        I_SEASON["Season"]
        I_DIV["Division  (I / II / III)"]
        I_GENDER["Gender  (Men's / Women's)"]
        I_LIMIT["Dates per run"]
        I_CC["☐ Capture team colors"]
        I_PS["☐ Include player stats"]
    end

    START(["Run Backfill"])
    SEASON_LOOKUP["Look up season by label\nfrom seasons table"]
    LOOP["For each date in range\n(up to Limit)"]
    NCAA1["NCAA API\nGetContests_web\n— one call per date —"]

    subgraph PER_GAME["For each contest returned"]
        UG["Upsert game\n→ games"]
        UT["Upsert teams\n→ teams\n→ conferences\n→ team_seasons"]
        FINAL{Game status\n= 'final'?}
        NEED_BS{"captureTeamColors\nOR\nincludePlayerStats?"}
        NCAA2["NCAA API\nGetGamecenterBoxscoreSoccerById_web\n— one call per final game —"]
        COLOR["Update team_color\non teams\n(only if currently null)"]
        PS_GATE{includePlayerStats?}
        WRITE_PS["Upsert\n→ players\n→ player_seasons\n→ player_game_stats"]
        SKIP_GAME["skip box score"]
    end

    LOG["Write to scrape_log\n(success or error)"]
    WAIT["Wait 2 s"]
    DONE(["Return results summary"])

    START --> SEASON_LOOKUP --> LOOP --> NCAA1 --> UG & UT
    UG --> FINAL
    FINAL -- no --> LOG
    FINAL -- yes --> NEED_BS
    NEED_BS -- no --> SKIP_GAME --> LOG
    NEED_BS -- yes --> NCAA2
    NCAA2 --> COLOR --> PS_GATE
    PS_GATE -- no --> LOG
    PS_GATE -- yes --> WRITE_PS --> LOG
    LOG --> WAIT --> LOOP
    LOOP -- limit reached --> DONE

    style NCAA1 fill:#dbeafe,stroke:#3b82f6
    style NCAA2 fill:#dbeafe,stroke:#3b82f6
    style WRITE_PS fill:#dcfce7,stroke:#16a34a
    style COLOR fill:#dcfce7,stroke:#16a34a
    style UG fill:#dcfce7,stroke:#16a34a
    style UT fill:#dcfce7,stroke:#16a34a
    style LOG fill:#fef9c3,stroke:#ca8a04
```

### Checkbox impact summary

| Checkbox state | NCAA API calls | DB tables written |
|---|---|---|
| Neither checked | `GetContests_web` only | `teams`, `conferences`, `team_seasons`, `games`, `scrape_log` |
| Capture team colors only | + `GetGamecenterBoxscoreSoccerById_web` per final game | + `teams.team_color` (skipped if already set) |
| Include player stats only | + `GetGamecenterBoxscoreSoccerById_web` per final game | + `players`, `player_seasons`, `player_game_stats` |
| Both checked | + `GetGamecenterBoxscoreSoccerById_web` per final game | + `teams.team_color`, `players`, `player_seasons`, `player_game_stats` |

---

## Missing Stats

```mermaid
flowchart TD
    subgraph MS_INPUTS["Missing Stats — Inputs"]
        M_GENDER["Gender"]
        M_DIV["Division"]
        M_SEASON["Season"]
    end

    CHECK_BTN(["Check missing dates"])
    SEASON_LU["Look up season by label\nfrom seasons table"]
    RPC["DB Function\nget_dates_missing_player_stats\n\nSELECT contest_date, COUNT(*)\nFROM games\nWHERE status = 'final'\n  AND sport_code / division / season_id match\n  AND NOT EXISTS (player_game_stats row)\nGROUP BY contest_date"]

    RESULT{Any dates\nreturned?}
    SHOW_DATES["Show list of dates\nwith game count per date"]
    ALL_GOOD(["✓ Nothing missing"])

    SCRAPE_BTN(["Scrape  (per date)"])
    BF_CALL["POST /api/scrape/backfill\nstartDate = endDate = that date\nincludePlayerStats = true\nlimit = 100\ncaptureTeamColors = false"]

    NCAA1["NCAA API\nGetContests_web"]
    NCAA2["NCAA API\nGetGamecenterBoxscoreSoccerById_web\n(every final game — no checkbox needed)"]
    WRITE["Upsert\n→ teams / conferences / team_seasons\n→ games\n→ players\n→ player_seasons\n→ player_game_stats"]
    REMOVE["Date disappears from list\nonce stats are present"]

    CHECK_BTN --> SEASON_LU --> RPC --> RESULT
    RESULT -- none --> ALL_GOOD
    RESULT -- dates found --> SHOW_DATES --> SCRAPE_BTN
    SCRAPE_BTN --> BF_CALL --> NCAA1 --> NCAA2 --> WRITE --> REMOVE

    style NCAA1 fill:#dbeafe,stroke:#3b82f6
    style NCAA2 fill:#dbeafe,stroke:#3b82f6
    style WRITE fill:#dcfce7,stroke:#16a34a
    style RPC fill:#ede9fe,stroke:#7c3aed
    style ALL_GOOD fill:#dcfce7,stroke:#16a34a
```

> The "Scrape" button per date is equivalent to running Historic Backfill on that single date with **Include Player Stats** checked and **Capture Team Colors** off.
