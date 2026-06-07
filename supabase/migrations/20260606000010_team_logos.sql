-- Add logo storage fields to teams.
-- ncaa_logo_slug: the slug used in NCAA logo URLs (e.g. "north-carolina-st")
--   set by admin; not derivable reliably from team name alone.
-- logo_url_dark:  Supabase Storage public URL for the dark-background variant.
-- logo_url_light: Supabase Storage public URL for the light-background variant.
ALTER TABLE teams
  ADD COLUMN ncaa_logo_slug text,
  ADD COLUMN logo_url_dark  text,
  ADD COLUMN logo_url_light text;
