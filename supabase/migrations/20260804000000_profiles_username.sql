-- ============================================================
-- Usernames on profiles.
--
-- Every account gets a mandatory, unique (case-insensitive) display name so no
-- public surface ever has to fall back to an email address.
--
-- Existing accounts predate the column, so they are backfilled from their email
-- local-part and flagged `username_is_generated`. A generated name is a partial
-- email disclosure — publishing it would be the exact exposure this feature is
-- meant to avoid — so generated names are withheld from `public_profiles` until
-- the user confirms or changes one.
-- ============================================================

-- ── Columns ──────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN username              text,
  ADD COLUMN username_changed_at   timestamptz,
  ADD COLUMN username_is_generated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.username IS
  'Public display name. Unique case-insensitively. Never an email address.';
COMMENT ON COLUMN public.profiles.username_changed_at IS
  'When the user last chose a username. Null means never chosen (generated, or first choice pending). Drives the 30-day change cooldown.';
COMMENT ON COLUMN public.profiles.username_is_generated IS
  'True when the username was system-derived from the email local-part and the user has not yet seen it. Such profiles are excluded from public_profiles.';

-- ── Username generation ──────────────────────────────────────
-- Defined before the backfill so the backfill and the signup trigger derive
-- names identically. Mirrors deriveUsernameFromEmail() in src/lib/username.ts.
CREATE OR REPLACE FUNCTION public.generate_username_from_email(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN length(raw) = 0 THEN 'user'
           WHEN length(raw) < 3 THEN rpad(raw, 3, '0')
           ELSE left(raw, 20)
         END
    FROM (
      SELECT lower(regexp_replace(split_part(coalesce(p_email, ''), '@', 1),
                                  '[^A-Za-z0-9_]', '', 'g')) AS raw
    ) s;
$$;

-- ── Backfill from the email local-part ───────────────────────
-- Intra-batch collisions get a numeric suffix; every profile is still NULL at
-- this point, so allocate_username() can't help here.
WITH sized AS (
  SELECT u.id, public.generate_username_from_email(u.email) AS base
    FROM auth.users u
),
numbered AS (
  SELECT id, base,
         row_number() OVER (PARTITION BY base ORDER BY id) AS rn
    FROM sized
)
UPDATE public.profiles p
   SET username = CASE
                    WHEN n.rn = 1 THEN n.base
                    ELSE left(n.base, 20 - length(n.rn::text)) || n.rn::text
                  END,
       username_is_generated = true
  FROM numbered n
 WHERE n.id = p.id
   AND p.username IS NULL;

-- ── Constraints (added after the backfill so it can't fail on them) ──
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
    CHECK (username ~ '^[A-Za-z0-9_]{3,20}$');

ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles (lower(username));

-- ── Username history ─────────────────────────────────────────
-- A released name is held for 30 days so it can't be immediately claimed by
-- someone impersonating the previous owner.
CREATE TABLE public.username_history (
  id          bigserial   PRIMARY KEY,
  profile_id  uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  username    text        NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX username_history_lookup_idx
  ON public.username_history (lower(username), released_at DESC);

GRANT ALL ON TABLE public.username_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.username_history_id_seq TO service_role;

-- No policies: RLS on with zero policies denies all direct access. The table is
-- only ever touched through the SECURITY DEFINER functions below.
ALTER TABLE public.username_history ENABLE ROW LEVEL SECURITY;

-- ── Reserved names ───────────────────────────────────────────
-- Must stay in lockstep with RESERVED_USERNAMES in src/lib/username.ts.
CREATE OR REPLACE FUNCTION public.is_reserved_username(p_username text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(p_username) = ANY (ARRAY[
    'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'system',
    'root', 'null', 'undefined', 'anonymous', 'deleted', 'collegesoccer',
    'csio', 'ncaa'
  ]);
$$;

-- ── Availability check ───────────────────────────────────────
-- Granted to anon as well as authenticated: the register form runs signed out.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RETURN false;
  END IF;

  IF public.is_reserved_username(p_username) THEN
    RETURN false;
  END IF;

  -- Taken by somebody else (your own current name reads as available).
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(username) = lower(p_username)
       AND (v_uid IS NULL OR id <> v_uid)
  ) THEN
    RETURN false;
  END IF;

  -- Held by somebody else's recent release.
  IF EXISTS (
    SELECT 1 FROM public.username_history h
     WHERE lower(h.username) = lower(p_username)
       AND h.released_at > now() - interval '30 days'
       AND (v_uid IS NULL OR h.profile_id <> v_uid)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ── Set / change username ────────────────────────────────────
-- Returns: 'ok' | 'taken' | 'reserved' | 'invalid' | 'cooldown' | 'unauthenticated'
--
-- This is the ONLY write path for profiles.username. `authenticated` has no
-- UPDATE grant on profiles — the table carries is_admin, so a direct grant would
-- let any user escalate privileges or bypass the cooldown.
CREATE OR REPLACE FUNCTION public.set_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_current   text;
  v_generated boolean;
  v_changed   timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'unauthenticated';
  END IF;

  SELECT username, username_is_generated, username_changed_at
    INTO v_current, v_generated, v_changed
    FROM public.profiles
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RETURN 'invalid';
  END IF;

  IF public.is_reserved_username(p_username) THEN
    RETURN 'reserved';
  END IF;

  -- Confirming a generated name: clear the flag, keep the name, and do NOT start
  -- the cooldown. A user must never be locked into a name they didn't choose.
  IF v_generated AND lower(p_username) = lower(v_current) THEN
    UPDATE public.profiles
       SET username = p_username,
           username_is_generated = false
     WHERE id = v_uid;
    RETURN 'ok';
  END IF;

  -- Cooldown applies only to names the user actually chose.
  IF NOT v_generated
     AND v_changed IS NOT NULL
     AND v_changed > now() - interval '30 days' THEN
    RETURN 'cooldown';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(username) = lower(p_username) AND id <> v_uid
  ) THEN
    RETURN 'taken';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.username_history h
     WHERE lower(h.username) = lower(p_username)
       AND h.released_at > now() - interval '30 days'
       AND h.profile_id <> v_uid
  ) THEN
    RETURN 'reserved';
  END IF;

  -- Release the old name only if it was ever publicly claimed. A generated name
  -- was never published, so it doesn't need holding.
  IF NOT v_generated AND lower(v_current) <> lower(p_username) THEN
    INSERT INTO public.username_history (profile_id, username)
    VALUES (v_uid, v_current);
  END IF;

  UPDATE public.profiles
     SET username = p_username,
         username_is_generated = false,
         username_changed_at = now()
   WHERE id = v_uid;

  RETURN 'ok';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'taken';
END;
$$;

-- Find a free variant of a base name by appending an incrementing suffix.
CREATE OR REPLACE FUNCTION public.allocate_username(p_base text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_candidate text := p_base;
  v_suffix    int  := 1;
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_candidate)
  ) LOOP
    v_suffix    := v_suffix + 1;
    v_candidate := left(p_base, 20 - length(v_suffix::text)) || v_suffix::text;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- ── New signups carry their username in auth metadata ────────
-- The register form always supplies one. The generated fallback exists so that
-- any signup path which doesn't (a future OAuth or magic-link flow, or a deploy
-- window where the form is older than this migration) cannot fail outright — it
-- lands the user on a generated name, which is withheld from public_profiles
-- until they confirm it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_username  text;
  v_generated boolean := false;
BEGIN
  v_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  IF v_username IS NULL
     OR v_username !~ '^[A-Za-z0-9_]{3,20}$'
     OR public.is_reserved_username(v_username)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username))
  THEN
    v_username  := public.allocate_username(public.generate_username_from_email(new.email));
    v_generated := true;
  END IF;

  INSERT INTO public.profiles (id, username, username_is_generated)
  VALUES (new.id, v_username, v_generated);

  RETURN new;
END;
$$;

-- ── Public read surface ──────────────────────────────────────
-- Exposes username only — never is_admin, never email. Runs as owner (the PG
-- default for views), so it can aggregate across profiles despite the
-- select-own RLS policy, while withholding un-confirmed generated names.
CREATE VIEW public.public_profiles AS
  SELECT id, username
    FROM public.profiles
   WHERE NOT username_is_generated;

COMMENT ON VIEW public.public_profiles IS
  'Publicly displayable identities. Excludes profiles whose username is still system-generated and unconfirmed.';

-- ── Permissions ──────────────────────────────────────────────
-- Views need their own grants; table grants do not cascade.
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- Only these two are part of the client API. The internal helpers
-- (is_reserved_username, generate_username_from_email, allocate_username,
-- handle_new_user) are locked down in the follow-up grants migration — Postgres
-- grants EXECUTE to PUBLIC by default, so they need an explicit REVOKE.
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_username(text)       TO authenticated;
