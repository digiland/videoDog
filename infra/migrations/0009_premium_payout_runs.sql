-- M10: idempotency guard for monthly pool distribution
CREATE TABLE premium_payout_runs (
  year int NOT NULL,
  month int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (year, month)
);
