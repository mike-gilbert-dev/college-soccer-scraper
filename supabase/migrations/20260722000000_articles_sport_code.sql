-- ============================================================
-- Articles: add a sport dimension (men's / women's / general).
--
-- One nullable column drives two features:
--   1. Team-tag links resolve to the right gender's team page
--      (/teams/{id}?sport=MSO|WSO) instead of always defaulting to MSO.
--   2. The news section can filter by Men's / Women's / All.
--
-- NULL = "general" (not tied to one gender). General articles surface
-- only under the "All" news view; the gender tabs are strict (MSO/WSO).
-- ============================================================

ALTER TABLE articles
  ADD COLUMN sport_code text
    CHECK (sport_code IN ('MSO', 'WSO'));   -- NULL allowed = general

-- Backfill: every article that existed before this migration was written
-- under the men's-only era of the site, so classify them as MSO. New
-- articles choose their sport explicitly in the editor.
UPDATE articles SET sport_code = 'MSO' WHERE sport_code IS NULL;

-- Filtered list query: published + sport, newest first.
CREATE INDEX articles_published_sport_idx
  ON articles (sport_code, published_at DESC)
  WHERE status = 'published';
