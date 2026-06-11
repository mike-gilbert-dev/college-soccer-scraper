INSERT INTO storage.buckets (id, name, public)
VALUES ('ncaa-raw-games', 'ncaa-raw-games', false)
ON CONFLICT (id) DO NOTHING;
