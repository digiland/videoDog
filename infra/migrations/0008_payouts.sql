-- M9: payouts table
CREATE TYPE payout_state AS ENUM ('requested','processing','completed','failed');
CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id),
  requested_amount_minor bigint NOT NULL,
  payout_currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid REFERENCES fx_rates(id),
  msisdn text NOT NULL,
  state payout_state NOT NULL DEFAULT 'requested',
  provider_ref text,
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
