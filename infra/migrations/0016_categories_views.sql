-- 0016: content categories on videos and collections, and an index for view counts.
-- One category per item; it drives home chips, channel shelves and search filters.
CREATE TYPE content_category AS ENUM (
  'education', 'comedy', 'drama', 'music', 'faith', 'sports', 'lifestyle', 'other'
);

ALTER TABLE videos ADD COLUMN category content_category NOT NULL DEFAULT 'other';
ALTER TABLE collections ADD COLUMN category content_category NOT NULL DEFAULT 'other';

CREATE INDEX videos_category_published_idx ON videos (category, published_at DESC)
  WHERE state = 'published';
CREATE INDEX collections_category_published_idx ON collections (category, published_at DESC)
  WHERE state = 'published';

-- A view is a watch session that got past two counted heartbeats (~30s of playback).
CREATE INDEX watch_sessions_views_idx ON watch_sessions (video_id) WHERE heartbeat_count >= 2;

-- Channel handles are lowercase (HANDLE_PATTERN in @streamzw/shared); keep lookups exact.
ALTER TABLE users ADD CONSTRAINT users_handle_format
  CHECK (handle IS NULL OR handle ~ '^[a-z0-9][a-z0-9_.]{2,29}$');
