# StreamZW — walkthrough

End-to-end tour of the platform for the three user roles: **viewer**, **creator**, **admin**. Assumes you've completed the [README Quickstart](./README.md#quickstart): Postgres + Redis up, migrations applied, `pnpm --filter api seed` run, `pnpm dev` running.

> Heads-up: a number of pipes are not yet wired end-to-end — see [docs/REVIEW.md](./docs/REVIEW.md). The flows below note where you'll currently hit a wall (e.g. PPV purchase, sub renewal cron, transcode worker bootstrap).

---

## Demo credentials

Sign-in is **phone + OTP**. There is no password. In dev (`NODE_ENV !== 'production'`) the OTP code is **logged to the API console** by `WhatsAppClient` / `SmsClient` (`apps/api/src/modules/notifications/*.client.ts`). Look for a log line like:

```
[WhatsAppClient]  OTP code (dev)  { to: '+263771000001', code: '482910', channel: 'whatsapp' }
```

The `pnpm --filter api seed` script creates three demo users:

| Role    | Phone (E.164)   | Handle         | Notes                                                                            |
| ------- | --------------- | -------------- | -------------------------------------------------------------------------------- |
| viewer  | `+263771000001` | `demo_viewer`  | watch / buy / subscribe                                                          |
| creator | `+263771000002` | `demo_creator` | upload / publish / payouts. Canonical pricing currency locked to USD.            |
| admin   | `+263771000099` | `demo_admin`   | admin grants, FX override, internal endpoints (use `RolesGuard('admin')` routes) |

To sign in, send an OTP for the desired phone, read the code from API logs, then verify:

```bash
# 1. Request OTP (dev: code goes to api console logs, not WhatsApp)
curl -X POST http://localhost:3001/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+263771000002"}'

# 2. Verify — copy the 6-digit code from api logs
curl -X POST http://localhost:3001/auth/otp/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"+263771000002","code":"482910"}'  # field is `code`, not OTP
# → { access_token, refresh_token, user: { id, role: "creator", ... } }
```

Save `access_token` and `refresh_token`. Access tokens live 15 minutes; rotate via `POST /auth/refresh` with the refresh token. Web UI handles this transparently.

### Promoting a user to admin manually

The seed already creates `demo_admin`. To promote an existing user:

```bash
docker exec -it streamzw-postgres psql -U streamzw -d streamzw \
  -c "UPDATE users SET role='admin' WHERE phone_e164='+263XXXXXXXXX';"
```

---

## Viewer flow (`demo_viewer`)

1. **Browse** — open <http://localhost:3000>. Catalogue lists `published` videos; free videos play without sign-in. Search via `/search?q=…&mode=free|ppv|premium`.
2. **Sign in** — top-right "Sign in" → enter `+263771000001` → read OTP from API logs → verify.
3. **Watch free** — click any `free` video. Player streams signed HLS from BunnyCDN (or RustFS direct in dev). Heartbeats fire every 15 s and accumulate in `watch_sessions` / `watch_minutes_daily`.
4. **Hit a paywall** — open a `ppv` or `premium` video. `checkAccess` returns a `PaywallPayload` with the right options:
   - `ppv` → "Unlock for $1.49" button
   - `premium` → "Day pass $0.99 / Month $1.49" plans
   - `premium_buyable` → both buttons
5. **Subscribe** — pick a plan. POST `/subscriptions` then POST `/payments`. EcoCash sandbox returns a redirect URL → you complete the test payment → webhook lands at `/webhooks/ecocash` → ledger entries written → sub state flips to `active`.
   - ⚠️ **Known bug** — the subscription is currently inserted with `state='active'` _before_ the payment webhook fires (see REVIEW.md #4). Treat the flow as working "optimistically" until that's fixed.
6. **Buy a PPV** — ⚠️ **Currently broken**: no `POST /purchases` endpoint exists; only `admin-grants` inserts `purchases`. Use the admin grant flow below to simulate a successful PPV until the endpoint lands.
7. **Tip a free video** — POST `/payments` with `intent='tip'`. ⚠️ Non-USD tips currently drop without ledger entries.

## Creator flow (`demo_creator`)

1. **Sign in** as `+263771000002`. Role is already `creator` in seed.
2. **Studio** — go to <http://localhost:3000/studio>. Shows earnings, videos, payouts.
3. **Upload** — `/studio/upload`: pick an MP4 → multipart-presigned PUT to RustFS → `POST /videos/:id/complete-upload` enqueues `transcode` BullMQ job.
   - ⚠️ Transcode worker is defined in `apps/api/src/workers/transcode.worker.ts` but **never started**. Jobs queue but don't drain. Either start it manually or wait for the M3 wiring PR.
4. **Set access mode** — pick `free | ppv | premium | premium_buyable`. For PPV / premium_buyable, set price (will be persisted in the creator's `canonical_pricing_currency`, locked at first publish).
5. **Publish** — `POST /videos/:id/publish`. State machine: `uploading → processing → ready → published`.
6. **Earnings** — `/studio/earnings`:
   - PPV: 70 % credited to `creator_balance.USD` on webhook (instant). Non-USD goes via `fx_holding` → USD per CLAUDE.md §5.
   - Premium pool: monthly cron at 01:00 CAT distributes `sub_revenue × 0.55` proportional to watch-minutes on `in_premium_pool` videos.
     - ⚠️ Cron not scheduled in `main.ts`. Run worker by hand to test.
   - Tips: 90 % credited to creator.
7. **Request payout** — `/studio/payouts`. Min thresholds: USD ≥ $5.00, ZWG ≥ 150, ZAR ≥ 100. Inserts a `payouts` row in `requested`. ⚠️ Non-USD payout path not implemented.

## Admin flow (`demo_admin`)

1. **Sign in** as `+263771000099`. Role `admin` from seed.
2. **Grant access** — `POST /admin/grants` with `{ user_id, video_id }`. Inserts a `purchases` row directly so the user bypasses the paywall. Useful for support and to unblock PPV testing until the buy endpoint lands.
3. **FX override** — `POST /admin/fx/override` with `{ base, quote, rate, effective_from }`. Inserts a `fx_rates` row with `source='manual', source_priority=100` so it wins lookups.
4. **Refresh rates** — `POST /admin/fx/refresh` (cron equivalent: `fx.refresh` at 06:00 CAT). Pulls RBZ scraper + OpenExchangeRates → new `fx_rates` rows.
5. **Inspect ledger** — there's no admin UI for ledger inspection yet; query directly:

   ```sql
   SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY occurred_at;
   ```

---

## Database — what's where

Connection string in dev: `postgres://streamzw:streamzw@127.0.0.1:5433/streamzw`.

```bash
docker exec -it streamzw-postgres psql -U streamzw -d streamzw
# or
psql postgres://streamzw:streamzw@127.0.0.1:5433/streamzw
```

Migrations live in [infra/migrations/](./infra/migrations/) and are applied in order by node-pg-migrate (`pnpm --filter api migrate`):

| #    | File                               | Purpose                                                                                                                  |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0001 | `0001_init.sql`                    | `users` (with `role`, `kyc_state`, `canonical_pricing_currency`), `otp_challenges`, `refresh_tokens`                     |
| 0002 | `0002_videos.sql`                  | `videos` (incl. generated `in_premium_pool`, `search_doc` tsvector), `renditions`                                        |
| 0003 | `0003_watch.sql`                   | `watch_sessions`, `watch_minutes_daily` rollup                                                                           |
| 0004 | `0004_purchases.sql`               | `purchases` (PPV) with `UNIQUE(user_id, video_id)`                                                                       |
| 0005 | `0005_payments_ledger.sql`         | `payments` (incl. `idempotency_key UNIQUE`), `accounts`, `ledger_entries` + append-only triggers, system accounts seeded |
| 0006 | `0006_fx.sql`                      | `fx_rates` with `(base, quote, effective_from)` covering index                                                           |
| 0007 | `0007_subscription_plans_seed.sql` | `subscription_plans`, `subscriptions`, plus seeded `day_pass` ($0.99) and `month` ($1.49) plans                          |
| 0008 | `0008_payouts.sql`                 | `payouts` with `state` and `provider_ref`                                                                                |
| 0009 | `0009_premium_payout_runs.sql`     | per-month idempotency rows for the premium-pool cron                                                                     |

### Inspecting state

```sql
-- Who's signed up
SELECT id, phone_e164, role, canonical_pricing_currency FROM users;

-- A user's catalogue access
SELECT id, title, access_mode, state, in_premium_pool
  FROM videos WHERE owner_id = (SELECT id FROM users WHERE handle='demo_creator');

-- Active subs
SELECT u.handle, s.state, s.expires_at, s.charged_amount_minor, s.charged_currency
  FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.state = 'active';

-- A creator's USD balance
SELECT
  COALESCE(SUM(credit_minor), 0) - COALESCE(SUM(debit_minor), 0) AS balance_minor
FROM ledger_entries le
JOIN accounts a ON a.id = le.account_id
WHERE a.scope='user' AND a.code='creator_balance' AND a.currency='USD'
  AND a.owner_id = (SELECT id FROM users WHERE handle='demo_creator');

-- Verify ledger transaction balances per currency
SELECT transaction_id, currency,
       SUM(debit_minor) AS d, SUM(credit_minor) AS c
FROM ledger_entries GROUP BY transaction_id, currency
HAVING SUM(debit_minor) <> SUM(credit_minor);
-- → should return zero rows

-- Latest FX rate
SELECT base, quote, rate, source, source_priority, effective_from
FROM fx_rates WHERE effective_until IS NULL OR effective_until > now()
ORDER BY base, quote, source_priority DESC, fetched_at DESC;

-- Today's watch minutes by video
SELECT v.title, wmd.minutes
FROM watch_minutes_daily wmd JOIN videos v ON v.id = wmd.video_id
WHERE wmd.date = current_date ORDER BY wmd.minutes DESC LIMIT 10;
```

### Account codes (system / user)

`accounts.code` is the chart-of-accounts label, scoped by `(scope, owner_id, currency)`:

- `payment_received` — system, per currency: where viewer funds land first
- `fx_holding` — system, per currency: non-USD funds waiting for USD conversion
- `creator_balance` — user-scoped (the creator), USD: payout source
- `platform_revenue` — system, USD: 30 % cut
- `premium_pool` — system, USD: 55 % of sub revenue, drained monthly

Non-USD PPV flow is two transactions per CLAUDE.md §5:

1. Dr `payment_received.ZWG` / Cr `fx_holding.ZWG`
2. Dr `fx_holding.USD` / Cr `creator_balance.USD` (70 %) + Cr `platform_revenue.USD` (30 %)

FX P&L accumulates in `fx_holding`.

---

## Useful one-liners

```bash
# Tail API logs (where OTPs land in dev)
docker logs -f streamzw-api 2>&1 | grep -E 'OTP|webhook|ledger'

# Rebuild seeded subscription plans (if you wipe them)
pnpm --filter api migrate:down  # rolls back the seed
pnpm --filter api migrate       # re-applies

# Reset everything
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm --filter api migrate && pnpm --filter api seed
```

For the bug list and what's actually wired vs. what's still on the bench, see [docs/REVIEW.md](./docs/REVIEW.md).
