-- ============================================================
-- Pick'em stats for the public profile page.
--
-- Both functions are SECURITY DEFINER so they can aggregate across all users'
-- picks (RLS restricts picks to their owner). They expose ONLY the named user's
-- own history plus field-wide AGGREGATES — never another identifiable user's
-- individual picks, and never a pick on an unstarted game.
--
-- Records are per season AND per sport by design. A 22%-draw men's record and a
-- women's record don't combine into a number that means anything.
-- ============================================================

-- ── Record, rank and streaks ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_pick_summary(
  p_username   text,
  p_season_id  bigint,
  p_sport_code text
)
RETURNS TABLE (
  wins           int,
  losses         int,
  voids          int,
  graded         int,
  win_pct        numeric,
  rank           int,
  best_streak    int,
  current_streak int
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- public_profiles excludes un-confirmed generated usernames, so those 404.
  SELECT id INTO v_uid
    FROM public.public_profiles
   WHERE lower(username) = lower(p_username);

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT p.id, p.result, g.contest_date
      FROM public.picks p
      JOIN public.games g ON g.id = p.game_id
     WHERE p.user_id    = v_uid
       AND p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IS NOT NULL
  ),
  totals AS (
    SELECT count(*) FILTER (WHERE result = 'win')::int  AS w,
           count(*) FILTER (WHERE result = 'loss')::int AS l,
           count(*) FILTER (WHERE result = 'void')::int AS v,
           count(*)::int                                AS g
      FROM mine
  ),
  -- Voids drop out of streaks entirely: a cancelled game shouldn't end a run.
  ordered AS (
    SELECT result,
           row_number() OVER (ORDER BY contest_date, id) AS rn
      FROM mine
     WHERE result IN ('win', 'loss')
  ),
  islands AS (
    SELECT result, rn,
           rn - row_number() OVER (PARTITION BY result ORDER BY rn) AS grp
      FROM ordered
  ),
  win_streaks AS (
    SELECT count(*)::int AS len, max(rn) AS last_rn
      FROM islands
     WHERE result = 'win'
     GROUP BY grp
  ),
  -- Season rank by total wins, matching the "Most Wins" leaderboard.
  field AS (
    SELECT p.user_id,
           count(*) FILTER (WHERE p.result = 'win')::int AS w
      FROM public.picks p
      JOIN public.public_profiles pp ON pp.id = p.user_id
     WHERE p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IS NOT NULL
     GROUP BY p.user_id
  ),
  ranks AS (
    SELECT user_id, rank() OVER (ORDER BY w DESC)::int AS rnk FROM field
  )
  SELECT t.w, t.l, t.v, t.g,
         CASE WHEN (t.w + t.l) > 0
              THEN round(t.w::numeric / (t.w + t.l), 4)
              ELSE NULL
         END,
         (SELECT rnk FROM ranks WHERE user_id = v_uid),
         coalesce((SELECT max(len) FROM win_streaks), 0),
         coalesce((SELECT len FROM win_streaks
                    WHERE last_rn = (SELECT max(rn) FROM ordered)), 0)
    FROM totals t;
END;
$$;

-- ── Season timeline: the user against the field ──────────────
-- One row per date the user has a graded pick.
--
-- field_cum_pct is the POOLED rate — all users' cumulative wins over all users'
-- cumulative decided picks — not the mean of individual users' percentages.
-- With few users early in a season, a per-user mean swings wildly on tiny
-- samples; pooled is stable from week one.
CREATE OR REPLACE FUNCTION public.get_pick_timeline(
  p_username   text,
  p_season_id  bigint,
  p_sport_code text
)
RETURNS TABLE (
  contest_date  date,
  user_wins     int,
  user_losses   int,
  user_cum_wins int,
  user_cum_pct  numeric,
  field_cum_pct numeric
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid
    FROM public.public_profiles
   WHERE lower(username) = lower(p_username);

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH user_daily AS (
    SELECT g.contest_date AS d,
           count(*) FILTER (WHERE p.result = 'win')::int  AS w,
           count(*) FILTER (WHERE p.result = 'loss')::int AS l
      FROM public.picks p
      JOIN public.games g ON g.id = p.game_id
     WHERE p.user_id    = v_uid
       AND p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IN ('win', 'loss')
     GROUP BY g.contest_date
  ),
  field_daily AS (
    SELECT g.contest_date AS d,
           count(*) FILTER (WHERE p.result = 'win')                AS w,
           count(*) FILTER (WHERE p.result IN ('win', 'loss'))     AS decided
      FROM public.picks p
      JOIN public.games g ON g.id = p.game_id
      JOIN public.public_profiles pp ON pp.id = p.user_id
     WHERE p.season_id  = p_season_id
       AND p.sport_code = p_sport_code
       AND p.result IN ('win', 'loss')
     GROUP BY g.contest_date
  ),
  field_cum AS (
    SELECT d,
           sum(w)       OVER (ORDER BY d) AS cw,
           sum(decided) OVER (ORDER BY d) AS cd
      FROM field_daily
  )
  SELECT ud.d,
         ud.w,
         ud.l,
         (sum(ud.w) OVER (ORDER BY ud.d))::int,
         CASE WHEN sum(ud.w + ud.l) OVER (ORDER BY ud.d) > 0
              THEN round(
                     (sum(ud.w) OVER (ORDER BY ud.d))::numeric
                     / (sum(ud.w + ud.l) OVER (ORDER BY ud.d)), 4)
              ELSE NULL
         END,
         (SELECT CASE WHEN fc.cd > 0 THEN round(fc.cw::numeric / fc.cd, 4) ELSE NULL END
            FROM field_cum fc
           WHERE fc.d <= ud.d
           ORDER BY fc.d DESC
           LIMIT 1)
    FROM user_daily ud
   ORDER BY ud.d;
END;
$$;

-- ── Recent picks list ────────────────────────────────────────
-- The profile page is public, but RLS lets a user SELECT only their OWN picks —
-- so a direct read returns nothing for a visitor looking at someone else's
-- profile (and nothing at all for anon). This function is the read path.
--
-- `result IS NOT NULL` is a HARD REQUIREMENT, not a filter for tidiness: it is
-- what guarantees an unstarted game's pick can never be exposed to anyone but
-- its owner. Do not relax it.
CREATE OR REPLACE FUNCTION public.get_recent_picks(
  p_username   text,
  p_season_id  bigint,
  p_sport_code text,
  p_limit      int DEFAULT 25
)
RETURNS TABLE (
  game_id          bigint,
  ncaa_contest_id  text,
  contest_date     date,
  outcome          text,
  result           text,
  home_score       smallint,
  away_score       smallint,
  shootout         boolean,
  home_team        text,
  away_team        text,
  home_logo_light  text,
  home_logo_dark   text,
  away_logo_light  text,
  away_logo_dark   text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid
    FROM public.public_profiles
   WHERE lower(username) = lower(p_username);

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT g.id,
         g.ncaa_contest_id,
         g.contest_date,
         p.outcome::text,
         p.result::text,
         g.home_score,
         g.away_score,
         g.shootout,
         coalesce(ht.short_name, ht.name),
         coalesce(at.short_name, at.name),
         ht.logo_url_light, ht.logo_url_dark,
         at.logo_url_light, at.logo_url_dark
    FROM public.picks p
    JOIN public.games g          ON g.id  = p.game_id
    JOIN public.team_seasons hts ON hts.id = g.home_team_season_id
    JOIN public.teams ht         ON ht.id  = hts.team_id
    JOIN public.team_seasons ats ON ats.id = g.away_team_season_id
    JOIN public.teams at         ON at.id  = ats.team_id
   WHERE p.user_id    = v_uid
     AND p.season_id  = p_season_id
     AND p.sport_code = p_sport_code
     AND p.result IS NOT NULL          -- never expose an ungraded pick
   ORDER BY g.contest_date DESC, g.id DESC
   LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
END;
$$;

-- ── Permissions ──────────────────────────────────────────────
-- Profiles are public, so anon reads them too.
GRANT EXECUTE ON FUNCTION public.get_user_pick_summary(text, bigint, text)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pick_timeline(text, bigint, text)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_picks(text, bigint, text, int)       TO anon, authenticated;
