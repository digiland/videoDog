-- M3: videos and renditions
CREATE TYPE access_mode AS ENUM ('free','ppv','premium','premium_buyable');
CREATE TYPE video_state AS ENUM ('uploading','processing','ready','published','unpublished','failed');

CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  access_mode access_mode NOT NULL,
  ppv_price_minor_units bigint,
  ppv_price_currency char(3),
  in_premium_pool boolean GENERATED ALWAYS AS (access_mode IN ('premium','premium_buyable')) STORED,
  state video_state NOT NULL DEFAULT 'uploading',
  duration_seconds int,
  hls_playlist_key text,
  thumbnail_key text,
  search_doc tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) STORED,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ppv_price_required CHECK (
    (access_mode IN ('ppv','premium_buyable') AND ppv_price_minor_units IS NOT NULL AND ppv_price_currency IS NOT NULL)
    OR access_mode IN ('free','premium')
  )
);

CREATE INDEX videos_search_idx ON videos USING GIN (search_doc);
CREATE INDEX videos_published_idx ON videos (published_at DESC) WHERE state = 'published';
CREATE INDEX videos_premium_pool_idx ON videos (in_premium_pool) WHERE state = 'published';

CREATE TABLE renditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  height int NOT NULL,
  bitrate_kbps int NOT NULL,
  key text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, height)
);
