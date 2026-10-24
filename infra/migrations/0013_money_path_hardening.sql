-- 0013: money-path hardening.

-- Payer number on each payment, so subscription renewals can charge the same wallet.
ALTER TABLE payments ADD COLUMN payer_msisdn text;

-- UNIQUE (scope, owner_id, code, currency) treats NULL owner_ids as distinct, so concurrent
-- first use of a system account could create duplicates and split its balance. Postgres 15+
-- NULLS NOT DISTINCT closes that. Fails loudly if duplicates already exist — merge them first.
CREATE UNIQUE INDEX accounts_scope_owner_code_currency_uniq
  ON accounts (scope, owner_id, code, currency) NULLS NOT DISTINCT;
