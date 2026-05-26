-- M6: payments + double-entry ledger
CREATE TYPE payment_provider AS ENUM ('ecocash_usd','ecocash_zwg','zipit','paystack');
CREATE TYPE payment_state AS ENUM ('initiated','pending','completed','failed','reversed');
CREATE TYPE payment_intent_type AS ENUM ('purchase','subscription','tip','topup');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider payment_provider NOT NULL,
  provider_ref text,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid,
  intent payment_intent_type NOT NULL,
  intent_ref_id uuid,
  state payment_state NOT NULL DEFAULT 'initiated',
  idempotency_key text UNIQUE NOT NULL,
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_provider_ref_idx ON payments (provider, provider_ref);

ALTER TABLE purchases ADD CONSTRAINT purchases_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  owner_id uuid,
  code text NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, owner_id, code, currency)
);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid,
  ref_type text NOT NULL,
  ref_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (debit_minor >= 0 AND credit_minor >= 0),
  CHECK ((debit_minor > 0) <> (credit_minor > 0))
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, occurred_at);
CREATE INDEX ledger_transaction_idx ON ledger_entries (transaction_id);

CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END; $$;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

INSERT INTO accounts (scope, owner_id, code, currency) VALUES
  ('system', NULL, 'payment_received', 'USD'),
  ('system', NULL, 'payment_received', 'ZWG'),
  ('system', NULL, 'payment_received', 'ZAR'),
  ('system', NULL, 'fx_holding', 'USD'),
  ('system', NULL, 'fx_holding', 'ZWG'),
  ('system', NULL, 'fx_holding', 'ZAR'),
  ('system', NULL, 'premium_pool', 'USD'),
  ('system', NULL, 'platform_revenue', 'USD'),
  ('system', NULL, 'platform_revenue', 'ZWG'),
  ('system', NULL, 'platform_revenue', 'ZAR'),
  ('system', NULL, 'payout_pending', 'USD'),
  ('system', NULL, 'payout_pending', 'ZWG'),
  ('system', NULL, 'payout_pending', 'ZAR'),
  ('system', NULL, 'external_clearing', 'USD'),
  ('system', NULL, 'external_clearing', 'ZWG'),
  ('system', NULL, 'external_clearing', 'ZAR');
