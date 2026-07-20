-- News / articles feature — public bucket for hero + inline body images.
-- Public so the site can serve images directly. Uploads go through the
-- admin-gated upload endpoint (supabaseAdmin / service_role).

insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;
