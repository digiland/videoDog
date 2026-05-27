-- 0010: creator application flow — viewers apply, admins approve.
CREATE TYPE creator_app_state AS ENUM ('none', 'pending', 'approved', 'rejected');

ALTER TABLE users
  ADD COLUMN creator_application_state creator_app_state NOT NULL DEFAULT 'none',
  ADD COLUMN creator_application_pitch text,
  ADD COLUMN creator_application_at    timestamptz,
  ADD COLUMN creator_application_decided_at timestamptz,
  ADD COLUMN creator_application_decided_by uuid REFERENCES users(id);

CREATE INDEX users_creator_app_pending_idx
  ON users (creator_application_at DESC)
  WHERE creator_application_state = 'pending';
