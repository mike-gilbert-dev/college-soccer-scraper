-- Returns every distinct game date for a given season/sport/division.
-- Called from the scoreboard to populate the date-navigation arrows.
-- Using a function bypasses PostgREST's per-request max-rows limit,
-- which would otherwise truncate a full season's worth of game rows.
CREATE OR REPLACE FUNCTION public.get_game_dates(
    p_season_id bigint,
    p_sport_code text,
    p_division  smallint
)
RETURNS TABLE(contest_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT g.contest_date
    FROM   games g
    WHERE  g.season_id  = p_season_id
      AND  g.sport_code = p_sport_code
      AND  g.division   = p_division
    ORDER  BY g.contest_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_game_dates(bigint, text, smallint)
    TO anon, authenticated, service_role;