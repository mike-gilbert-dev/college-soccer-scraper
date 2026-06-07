-- ============================================================
-- Permissions for scraper tables
-- Run this after 20260606000000_initial_schema.sql
-- ============================================================

-- Grant the service_role full access for server-side scraping.
-- This is necessary alongside RLS — service_role bypasses RLS
-- policies, but still needs table-level GRANT.
GRANT ALL ON TABLE seasons      TO service_role;
GRANT ALL ON TABLE conferences  TO service_role;
GRANT ALL ON TABLE teams        TO service_role;
GRANT ALL ON TABLE games        TO service_role;
GRANT ALL ON TABLE scrape_log   TO service_role;

-- Sequences need separate grants for INSERT (bigserial columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── Public read-only access (scores are public data) ─────────
ALTER TABLE seasons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE games       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read seasons"     ON seasons     FOR SELECT USING (true);
CREATE POLICY "public read conferences" ON conferences FOR SELECT USING (true);
CREATE POLICY "public read teams"       ON teams       FOR SELECT USING (true);
CREATE POLICY "public read games"       ON games       FOR SELECT USING (true);

-- scrape_log: no public access — service_role only
ALTER TABLE scrape_log ENABLE ROW LEVEL SECURITY;
