-- M8: seed subscription plans
INSERT INTO subscription_plans (code, duration_days, base_price_minor_units, base_currency) VALUES
  ('day_pass', 1, 99, 'USD'),
  ('week', 7, 119, 'USD'),
  ('month', 30, 149, 'USD');
