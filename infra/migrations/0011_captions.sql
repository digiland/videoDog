-- 0011: per-video captions / subtitles (WebVTT files).
CREATE TYPE caption_kind AS ENUM ('subtitles', 'captions');

CREATE TABLE captions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id      uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  language      text NOT NULL,                                   -- BCP-47, e.g. 'en', 'sn', 'nd'
  label         text NOT NULL,                                   -- human label, e.g. 'English'
  kind          caption_kind NOT NULL DEFAULT 'subtitles',
  key           text NOT NULL,                                   -- S3 / RustFS object key
  is_default    boolean NOT NULL DEFAULT false,
  ready         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, language, kind)
);

CREATE INDEX captions_video_idx ON captions (video_id);

-- One row at most per (video, kind) can be default
CREATE UNIQUE INDEX captions_one_default_per_video
  ON captions (video_id, kind)
  WHERE is_default = true;
