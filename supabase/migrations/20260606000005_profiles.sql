-- ============================================================
-- User profiles with admin flag.
-- One row per auth.users entry — auto-created via trigger.
-- ============================================================

CREATE TABLE profiles (
  id       uuid    PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false
);

-- Auto-create a profile row whenever a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (new.id);
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Backfill profiles for users who already exist
INSERT INTO profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── Permissions ──────────────────────────────────────────────
GRANT ALL ON TABLE profiles TO service_role;
GRANT SELECT ON TABLE profiles TO authenticated;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

-- ── Grant admin access (run manually for each admin) ─────────
-- UPDATE profiles SET is_admin = true WHERE id = '<user-uuid>';
