-- M7: FX rates table
CREATE TABLE fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base char(3) NOT NULL,
  quote char(3) NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,
  source_priority smallint NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  notes text
);
CREATE INDEX fx_rates_lookup_idx ON fx_rates (base, quote, effective_from DESC);
CREATE UNIQUE INDEX fx_rates_open_source_idx ON fx_rates (base, quote, source)
  WHERE effective_until IS NULL;

ALTER TABLE payments ADD CONSTRAINT payments_fx_rate_id_fkey FOREIGN KEY (fx_rate_id) REFERENCES fx_rates(id);
ALTER TABLE purchases ADD CONSTRAINT purchases_fx_rate_id_fkey FOREIGN KEY (fx_rate_id) REFERENCES fx_rates(id);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_fx_rate_id_fkey FOREIGN KEY (fx_rate_id) REFERENCES fx_rates(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_fx_rate_id_fkey FOREIGN KEY (fx_rate_id) REFERENCES fx_rates(id);
