-- ============================================================
-- News / articles feature — core schema.
-- One row per article. Public site reads PUBLISHED rows only
-- (RLS); admin CRUD runs server-side via supabaseAdmin
-- (service_role, RLS-bypassing) behind the /admin hooks gate.
-- ============================================================

CREATE TABLE articles (
  id              bigserial   PRIMARY KEY,
  slug            text        NOT NULL UNIQUE,
  title           text        NOT NULL,
  subtitle        text,                         -- dek / summary line
  category        text,                         -- free-form label
  body_markdown   text        NOT NULL DEFAULT '',
  hero_image_path text,                         -- object key in article-images bucket
  hero_image_url  text,                         -- resolved public URL (convenience)
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'published')),
  published_at    timestamptz,                  -- editable; set on first publish
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Partial index for the public list query (published, newest first).
CREATE INDEX articles_published_idx
  ON articles (published_at DESC)
  WHERE status = 'published';
CREATE INDEX articles_status_idx ON articles (status);

-- ── Join tables: article ↔ tagged entities ──────────────────
-- Reference the bigserial id PKs for FK integrity (the UI links
-- out via the ncaa_* natural keys separately).
CREATE TABLE article_teams (
  article_id bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  team_id    bigint NOT NULL REFERENCES teams (id)    ON DELETE CASCADE,
  PRIMARY KEY (article_id, team_id)
);

CREATE TABLE article_players (
  article_id bigint NOT NULL REFERENCES articles (id)  ON DELETE CASCADE,
  player_id  bigint NOT NULL REFERENCES players (id)   ON DELETE CASCADE,
  PRIMARY KEY (article_id, player_id)
);

CREATE INDEX article_teams_team_idx     ON article_teams (team_id);
CREATE INDEX article_players_player_idx ON article_players (player_id);

-- ── updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_articles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_articles_updated_at();

-- ── Grants ──────────────────────────────────────────────────
-- service_role bypasses RLS but still needs table-level GRANT.
GRANT ALL ON TABLE articles, article_teams, article_players TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Public/authenticated read published articles via RLS.
GRANT SELECT ON TABLE articles, article_teams, article_players TO anon, authenticated;

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE articles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_players ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors may read ONLY published articles (drafts stay hidden).
CREATE POLICY "public read published articles"
  ON articles FOR SELECT USING (status = 'published');

-- Join rows readable by all; the parent article's RLS gates practical
-- visibility (a draft article is never selectable, so its tags never join).
CREATE POLICY "public read article_teams"
  ON article_teams FOR SELECT USING (true);
CREATE POLICY "public read article_players"
  ON article_players FOR SELECT USING (true);
