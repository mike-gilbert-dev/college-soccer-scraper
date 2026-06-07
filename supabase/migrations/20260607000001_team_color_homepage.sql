ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS team_color text,
    ADD COLUMN IF NOT EXISTS homepage   text;

COMMENT ON COLUMN public.teams.team_color IS 'Primary team color hex from NCAA box score API (e.g. #0033A0)';
COMMENT ON COLUMN public.teams.homepage   IS 'Official team athletic website URL — populated by a separate scraper';
