-- Roster project — Phase 4: durable headshot storage.
-- Adds a PUBLIC bucket for downloaded headshot images (so the site can serve
-- them directly) and season-scoped provenance columns on player_seasons. The
-- downloaded image is keyed by player_id within a sport/season/division/team
-- folder; headshot_url (the external source) stays as provenance.

insert into storage.buckets (id, name, public)
values ('player-headshots', 'player-headshots', true)
on conflict (id) do nothing;

alter table player_seasons
  add column headshot_path           text,        -- object key in player-headshots bucket
  add column headshot_downloaded_at  timestamptz,
  add column headshot_downloaded_from text;       -- source URL last fetched (change detection)
