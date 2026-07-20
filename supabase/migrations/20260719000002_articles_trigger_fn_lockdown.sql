-- Harden the articles updated_at trigger function: it is trigger-only and must
-- not be callable as a PostgREST RPC. Revoke EXECUTE from API roles (the trigger
-- still fires — triggers run as the table owner, independent of these grants).
-- Resolves advisor lint 0028/0029 (SECURITY DEFINER function executable by anon).

REVOKE EXECUTE ON FUNCTION public.set_articles_updated_at() FROM public, anon, authenticated;
