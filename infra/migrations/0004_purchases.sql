-- M5: purchases and subscriptions skeleton
CREATE TYPE purchase_state AS ENUM ('pending','completed','refunded','failed');

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  video_id uuid NOT NULL REFERENCES videos(id),
  state purchase_state NOT NULL DEFAULT 'pending',
  paid_amount_minor bigint NOT NULL DEFAULT 0,
  paid_currency char(3) NOT NULL DEFAULT 'USD',
  usd_equivalent_minor bigint NOT NULL DEFAULT 0,
  fx_rate_id uuid,
  payment_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

CREATE TYPE subscription_state AS ENUM ('active','expired','cancelled','past_due');

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  duration_days int NOT NULL,
  base_price_minor_units bigint NOT NULL,
  base_currency char(3) NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id uuid REFERENCES subscription_plans(id),
  state subscription_state NOT NULL DEFAULT 'active',
  charged_amount_minor bigint NOT NULL,
  charged_currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid,
  started_at timestamptz,
  expires_at timestamptz NOT NULL,
  auto_renew boolean NOT NULL DEFAULT true,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subs_active_idx ON subscriptions (user_id, expires_at) WHERE state = 'active';
