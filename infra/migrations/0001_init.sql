-- Migration 0001_init: users, otp_challenges, refresh_tokens
-- Source of truth: CLAUDE.md §9.
-- Invariants enforced: §3.13 (E.164 — app-layer Zod), §3.14 (refresh token rotation),
-- §3.15 (PII separation — national IDs not stored in users).

-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('viewer', 'creator', 'admin');
CREATE TYPE kyc_state AS ENUM ('none', 'phone_verified', 'id_verified');

-- E.164 phone validation lives in the app layer (Zod from @streamzw/shared) for clearer
-- error messages at API boundaries; no DB-level CHECK constraint is added here.
CREATE TABLE users (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                  text UNIQUE NOT NULL,
  handle                      text UNIQUE,
  display_name                text,
  role                        user_role NOT NULL DEFAULT 'viewer',
  kyc_state                   kyc_state NOT NULL DEFAULT 'none',
  preferred_display_currency  char(3) NOT NULL DEFAULT 'USD',
  preferred_payout_currency   char(3),
  canonical_pricing_currency  char(3),
  payout_msisdn               text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- otp_challenges intentionally has no updated_at — state changes are captured by
-- attempts/consumed_at directly, and rows are short-lived (5 min ttl).
CREATE TABLE otp_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164      text NOT NULL,
  code_hash       text NOT NULL,
  channel         text NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  rotated_to      uuid REFERENCES refresh_tokens(id),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS otp_challenges;
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS kyc_state;
DROP TYPE IF EXISTS user_role;
