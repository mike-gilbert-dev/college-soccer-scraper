-- ============================================================
-- Grant SELECT on public tables to the anon and authenticated
-- roles so that the Supabase publishable-key client can read
-- them. RLS policies alone are not sufficient — the role must
-- also have table-level GRANT to execute a query.
-- ============================================================

GRANT SELECT ON TABLE seasons      TO anon, authenticated;
GRANT SELECT ON TABLE conferences  TO anon, authenticated;
GRANT SELECT ON TABLE teams        TO anon, authenticated;
GRANT SELECT ON TABLE team_seasons TO anon, authenticated;
GRANT SELECT ON TABLE games        TO anon, authenticated;
