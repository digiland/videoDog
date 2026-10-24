-- 0017: live streaming. Each live stream is backed by a `videos` row (access_mode, price,
-- category, title live there), so checkAccess, purchases, the premium pool and watch
-- heartbeats work unchanged (CLAUDE.md §3.9, §3.10). After the stream ends, the recording
-- becomes that same video's HLS, so buyers keep their replay.
--
-- scheduled → live (first ingest) → ended (creator ends it, or ingest gone > grace)
-- scheduled → cancelled
CREATE TYPE live_state AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
CREATE TYPE recording_state AS ENUM ('none', 'pending', 'ready', 'failed');

CREATE TABLE live_streams (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id           uuid NOT NULL UNIQUE,
  owner_id           uuid NOT NULL,
  state              live_state NOT NULL DEFAULT 'scheduled',
  -- sha256 of the stream key; the key itself is shown to the creator once (create / reset).
  stream_key_hash    text NOT NULL,
  scheduled_at       timestamptz,
  started_at         timestamptz,
  ended_at           timestamptz,
  record             boolean NOT NULL DEFAULT true,
  recording_state    recording_state NOT NULL DEFAULT 'none',
  -- Ingest health, reported by the live worker.
  ingest_connected   boolean NOT NULL DEFAULT false,
  last_ingest_at     timestamptz,
  source_width       int,
  source_height      int,
  source_fps         int,
  source_codec       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (video_id, owner_id) REFERENCES videos (id, owner_id) ON DELETE CASCADE,
  CONSTRAINT live_started_when_live CHECK (state <> 'live' OR started_at IS NOT NULL),
  CONSTRAINT live_ended_when_ended CHECK (state NOT IN ('ended', 'cancelled') OR ended_at IS NOT NULL)
);
CREATE INDEX live_streams_state_idx ON live_streams (state, scheduled_at);
CREATE INDEX live_streams_owner_idx ON live_streams (owner_id, created_at DESC);
