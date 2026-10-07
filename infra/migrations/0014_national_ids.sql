-- 0014: national IDs live in their own encrypted table, never on users (CLAUDE.md §3.15).
-- The ID number is AES-256-GCM encrypted by the API; Postgres never sees plaintext.
-- lookup_hash is an HMAC of the normalised number so one ID can't back two accounts.
CREATE TABLE national_ids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ciphertext   bytea NOT NULL,
  iv           bytea NOT NULL,
  auth_tag     bytea NOT NULL,
  key_version  smallint NOT NULL DEFAULT 1,
  lookup_hash  text NOT NULL UNIQUE,
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
