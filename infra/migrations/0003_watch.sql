-- M4: watch sessions and daily aggregates
CREATE TABLE watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  video_id uuid NOT NULL REFERENCES videos(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  minutes_watched int NOT NULL DEFAULT 0,
  ended boolean NOT NULL DEFAULT false
);
CREATE INDEX watch_sessions_user_idx ON watch_sessions (user_id, started_at DESC);

CREATE TABLE watch_minutes_daily (
  date date NOT NULL,
  video_id uuid NOT NULL REFERENCES videos(id),
  minutes bigint NOT NULL,
  PRIMARY KEY (date, video_id)
);
CREATE INDEX watch_minutes_daily_video_idx ON watch_minutes_daily (video_id, date);
