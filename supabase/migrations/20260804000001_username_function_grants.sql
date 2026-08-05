-- ============================================================
-- Lock down the internal username helpers.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which meant
-- `allocate_username`, `generate_username_from_email`, `is_reserved_username`
-- and the `handle_new_user` trigger function were all reachable over PostgREST
-- (/rest/v1/rpc/<name>) — flagged by the Supabase security advisor.
--
-- None of them are part of the client API. They are only ever called from
-- inside SECURITY DEFINER functions (which execute as the owner and are
-- unaffected by these revokes) or as a trigger.
--
-- The two functions the client genuinely needs — username_available and
-- set_username — keep their explicit grants from the previous migration.
-- ============================================================

REVOKE ALL ON FUNCTION public.allocate_username(text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_username_from_email(text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_reserved_username(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()                   FROM PUBLIC, anon, authenticated;

-- set_username is authenticated-only. The default PUBLIC grant left it callable
-- by anon; it returns 'unauthenticated' in that case, but there's no reason to
-- expose it. Drop PUBLIC/anon and re-assert the intended grant.
REVOKE ALL ON FUNCTION public.set_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_username(text) TO authenticated;

-- username_available stays anon-callable on purpose: the register form runs
-- signed out and needs live availability feedback.
REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;
