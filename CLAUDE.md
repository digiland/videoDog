# CLAUDE.md — StreamZW

> Source of truth. Every change must respect the invariants in §3.

---

## 1. What this is

Creator-led video platform for Zimbabwe. Per video, the creator picks one access mode:

| Mode              | Behaviour                                                         |
| ----------------- | ----------------------------------------------------------------- |
| `free`            | Anyone watches. Optional tips.                                    |
| `ppv`             | One-time unlock.                                                  |
| `premium`         | Subscribers only.                                                 |
| `premium_buyable` | Subscribers free **AND** non-subscribers can buy a single unlock. |

Subscriptions $0.99 day-pass / $1.49 month. PPV $0.10–$2.00.

Multi-currency from day one — USD canonical; ZWG + ZAR first-class; EUR/GBP later. Mobile-first; offline downloads required in v1.

---

## 2. Locked tech decisions

Settled. Do not propose alternatives without approval.

| Layer         | Choice                                                |
| ------------- | ----------------------------------------------------- |
| Backend       | NestJS 11 (modular monolith)                          |
| Web           | Next.js 15 App Router (viewer + studio)               |
| Mobile        | Flutter 3.27+ (offline-first)                         |
| DB            | PostgreSQL 16                                         |
| Cache + queue | Redis 7 + BullMQ 5                                    |
| Storage       | MinIO (S3-compatible)                                 |
| CDN           | BunnyCDN (HLS, signed URLs)                           |
| Transcoder    | FFmpeg 7 (worker containers)                          |
| Auth          | Phone + OTP — WhatsApp Business primary, SMS fallback |
| Payments      | EcoCash (USD + ZWG separate), ZIPIT, Paystack         |
| Search        | Postgres `tsvector` (Meilisearch in phase 2)          |
| ORM           | Drizzle (SQL-first migrations)                        |
| Monorepo      | pnpm 9 workspaces + turbo                             |
| Runtime       | Node 22 LTS                                           |
| Containers    | docker-compose (k8s post-MVP)                         |
| CI            | GitHub Actions                                        |
| Lint/format   | ESLint + Prettier + Biome (web)                       |
| Tests         | Vitest (api, web) + Flutter test                      |

---

## 3. Invariants

Violations do not merge — they produce silent data corruption.

### Money

1. Every monetary field is `amount_minor_units: bigint` + `currency: char(3)`. Never `number`, `float`, decimal-as-string, or untagged.
2. Use the shared `Money` value object — never raw-number math in domain code.
3. Currency conversion is a **separate transaction** touching `fx_holding`. Never balance a debit in one currency with a credit in another inside one ledger entry.
4. Every monetary record snapshots FX (`usd_equivalent_minor_units` + `fx_rate_id`).
5. Pricing is in the creator's `canonical_currency`. Display conversion is render-only — never persist converted prices.
6. Subscriptions lock currency-and-amount for the term. Re-quote only at renewal.

### Ledger

7. `ledger_entries` is append-only. No `UPDATE`/`DELETE` — corrections are balancing entries.
8. Per transaction: `sum(debit) == sum(credit)` **per currency**.

### Access

9. `VideosService.checkAccess(user, video)` is the only view-permission check. Never inline in controllers, repositories, or UI.
10. Watched minutes derive from 15-second heartbeats, never start/stop events.

### Payments

11. Every payment webhook handler is idempotent (`idempotency_key` UNIQUE).
12. Reconcile payment intents against provider state on every state transition.

### Auth & PII

13. Phone numbers stored in E.164 (`+263…`).
14. Access JWTs 15-min. Refresh tokens rotate on every use.
15. National IDs (if collected) live in a separate encrypted table — never `users`.

---

## 4. Repository structure

```
apps/{api,web,mobile}
packages/{shared,ecocash,zipit,paystack,fx,ui}
infra/{docker-compose.yml,nginx/,minio/,migrations/}
docs/
```

`packages/shared` is the cross-app contract (Zod schemas → TS types, `Money`). A breaking change there fails CI in both `api` and `web`.

External integrations: EcoCash, ZIPIT, Paystack, WhatsApp Business API, SMS gateway, RBZ FX feed, Open Exchange Rates.

---

## 5. Multi-currency model

- **USD is canonical.** Accounting, premium pool, platform revenue, analytics — all USD minor units.
- **Other currencies live at the edges** — what viewer sees, pays, and what creator receives.
- **FX snapshotted.** Every monetary record references the `fx_rates` row in effect at transaction time.

v1: USD, ZWG, ZAR. Phase 2: EUR, GBP. Phase 3: USDT.

### `Money` (`packages/shared`)

```typescript
export type CurrencyCode = 'USD' | 'ZWG' | 'ZAR' | 'EUR' | 'GBP';

export class Money {
  constructor(
    public readonly amount: bigint,
    public readonly currency: CurrencyCode,
  ) {}
  static of(amount: bigint, currency: CurrencyCode): Money;
  static zero(currency: CurrencyCode): Money;
  add(other: Money): Money; // throws CurrencyMismatchError
  sub(other: Money): Money;
  mul(factor: number): Money; // bigint-safe, no float drift
  toUsdEquivalent(rate: FxRate): Money;
  format(locale: string): string;
}
```

### FX rate resolution

```
active row in fx_rates where base=$b AND quote=$q
  AND effective_from <= $at < COALESCE(effective_until, '+infinity')
order by source_priority DESC (manual=100, rbz=50, oxr=10), fetched_at DESC
LIMIT 1
```

Daily cron `fx.refresh` (06:00 CAT) fetches RBZ + OXR. Admin override creates a `source='manual'` row at top priority.

### Non-USD purchase flow (e.g. ZWG)

Two ledger transactions:

1. Receipt: `Dr payment_received.ZWG | Cr fx_holding.ZWG`
2. FX to canonical: `Dr fx_holding.USD | Cr creator_balance.USD (70%) | Cr platform_revenue.USD (30%)`

FX P&L accumulates in `fx_holding`.

---

## 6. Access control

```typescript
async checkAccess(user: User | null, video: Video): Promise<AccessResult> {
  if (video.access_mode === 'free') return { ok: true };
  if (user) {
    if (video.in_premium_pool && await this.subs.isActive(user.id)) return { ok: true };
    if (await this.purchases.exists(user.id, video.id)) return { ok: true };
  }
  return {
    ok: false,
    paywall: this.buildPaywall(video, user?.preferred_display_currency ?? 'USD'),
  };
}
```

`in_premium_pool` is a generated column: `access_mode IN ('premium','premium_buyable')`.

`PaywallPayload`:

- `reasons: ('not_subscribed' | 'not_purchased')[]`
- `options.buy?: { price: Money }` — for `ppv` / `premium_buyable`
- `options.subscribe?: { plans: PlanQuote[] }` — for `premium` / `premium_buyable`

Anonymous viewers (`user = null`) — free plays, everything else paywalls.

---

## 7. Earnings

**PPV (instant on webhook):** 70% creator / 30% platform. Non-USD goes via `fx_holding` per §5.

**Premium pool (monthly cron, 01:00 CAT day 1):** `pool = sub_revenue_usd * 0.55`. Distribute proportionally to watch-minutes on `in_premium_pool` videos. Bigint-safe math, idempotent re-run (no new entries for the same month). The remaining 45% covers bandwidth, transcode, fees, margin.

**Tipping (free videos):** 10% platform cut.

**Min payout thresholds** (`WalletService.requestPayout`):

- USD ≥ `500` ($5.00)
- ZWG ≥ `15000` (150)
- ZAR ≥ `10000` (100)

---

## 8. Database schema

Versioned SQL migrations in `infra/migrations/`. Every table has `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, and `updated_at timestamptz not null default now()` unless stated.

```sql
-- USERS
CREATE TYPE user_role AS ENUM ('viewer','creator','admin');
CREATE TYPE kyc_state AS ENUM ('none','phone_verified','id_verified');

CREATE TABLE users (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                  text UNIQUE NOT NULL,
  handle                      text UNIQUE,
  display_name                text,
  role                        user_role NOT NULL DEFAULT 'viewer',
  kyc_state                   kyc_state NOT NULL DEFAULT 'none',
  preferred_display_currency  char(3) NOT NULL DEFAULT 'USD',
  preferred_payout_currency   char(3),
  canonical_pricing_currency  char(3),               -- locked at first publish
  payout_msisdn               text,                  -- E.164
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- AUTH
CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  channel text NOT NULL,                              -- 'whatsapp' | 'sms'
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  rotated_to uuid REFERENCES refresh_tokens(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- VIDEOS
CREATE TYPE access_mode AS ENUM ('free','ppv','premium','premium_buyable');
CREATE TYPE video_state AS ENUM ('uploading','processing','ready','published','unpublished','failed');

CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  access_mode access_mode NOT NULL,
  ppv_price_minor_units bigint,
  ppv_price_currency char(3),
  in_premium_pool boolean GENERATED ALWAYS AS
    (access_mode IN ('premium','premium_buyable')) STORED,
  state video_state NOT NULL DEFAULT 'uploading',
  duration_seconds int,
  hls_playlist_key text,
  thumbnail_key text,
  search_doc tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) STORED,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ppv_price_required CHECK (
    (access_mode IN ('ppv','premium_buyable')
       AND ppv_price_minor_units IS NOT NULL AND ppv_price_currency IS NOT NULL)
    OR access_mode IN ('free','premium')
  )
);
CREATE INDEX videos_search_idx ON videos USING GIN (search_doc);
CREATE INDEX videos_published_idx ON videos (published_at DESC) WHERE state='published';
CREATE INDEX videos_premium_pool_idx ON videos (in_premium_pool) WHERE state='published';

CREATE TABLE renditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  height int NOT NULL,                                -- 240 / 480 / 720 / 1080
  bitrate_kbps int NOT NULL,
  key text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, height)
);

-- FX
CREATE TABLE fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base char(3) NOT NULL,
  quote char(3) NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,                               -- 'rbz' | 'openexchangerates' | 'manual'
  source_priority smallint NOT NULL,                  -- manual=100, rbz=50, oxr=10
  fetched_at timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  notes text
);
CREATE INDEX fx_rates_lookup_idx ON fx_rates (base, quote, effective_from DESC)
  WHERE effective_until IS NULL OR effective_until > now();

-- SUBSCRIPTIONS
CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,                          -- 'day_pass','week','month'
  duration_days int NOT NULL,
  base_price_minor_units bigint NOT NULL,
  base_currency char(3) NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE subscription_state AS ENUM ('active','expired','cancelled','past_due');

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  state subscription_state NOT NULL DEFAULT 'active',
  charged_amount_minor bigint NOT NULL,               -- locked at signup
  charged_currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid REFERENCES fx_rates(id),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  auto_renew boolean NOT NULL DEFAULT true,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subs_active_idx ON subscriptions (user_id, expires_at) WHERE state='active';

-- PURCHASES (PPV)
CREATE TYPE purchase_state AS ENUM ('pending','completed','refunded','failed');

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  video_id uuid NOT NULL REFERENCES videos(id),
  state purchase_state NOT NULL DEFAULT 'pending',
  paid_amount_minor bigint NOT NULL,
  paid_currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid REFERENCES fx_rates(id),
  payment_id uuid REFERENCES payments(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

-- PAYMENTS
CREATE TYPE payment_provider AS ENUM ('ecocash_usd','ecocash_zwg','zipit','paystack');
CREATE TYPE payment_state AS ENUM ('initiated','pending','completed','failed','reversed');
CREATE TYPE payment_intent AS ENUM ('purchase','subscription','tip','topup');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider payment_provider NOT NULL,
  provider_ref text,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  usd_equivalent_minor bigint NOT NULL,
  fx_rate_id uuid REFERENCES fx_rates(id),
  intent payment_intent NOT NULL,
  intent_ref_id uuid,                                 -- purchase_id / subscription_id
  state payment_state NOT NULL DEFAULT 'initiated',
  idempotency_key text UNIQUE NOT NULL,
  raw_callback jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_provider_ref_idx ON payments (provider, provider_ref);

-- LEDGER
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,                                -- 'user' | 'system'
  owner_id uuid,
  code text NOT NULL,                                 -- 'creator_balance' | 'platform_revenue' | 'fx_holding' | 'premium_pool' | 'payment_received'
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
  fx_rate_id uuid REFERENCES fx_rates(id),
  ref_type text NOT NULL,
  ref_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (debit_minor >= 0 AND credit_minor >= 0),
  CHECK ((debit_minor > 0) <> (credit_minor > 0))
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, occurred_at);
CREATE INDEX ledger_transaction_idx ON ledger_entries (transaction_id);

-- PAYOUTS
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

-- WATCH
CREATE TABLE watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),                  -- nullable for anonymous
  video_id uuid NOT NULL REFERENCES videos(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  minutes_watched int NOT NULL DEFAULT 0,
  ended boolean NOT NULL DEFAULT false
);
CREATE INDEX watch_sessions_user_idx ON watch_sessions (user_id, started_at DESC);

CREATE TABLE watch_minutes_daily (
  date date NOT NULL,
  video_id uuid NOT NULL REFERENCES videos(id),
  minutes bigint NOT NULL,
  PRIMARY KEY (date, video_id)
);
CREATE INDEX watch_minutes_daily_video_idx ON watch_minutes_daily (video_id, date);
```

---

## 9. NestJS modules

Layout per module: `<name>.{module,controller,service,repository,spec}.ts` + `dto/` (Zod schemas re-exported from `@streamzw/shared`). Drizzle queries in services; raw SQL allowed only in `*.repository.ts`.

| Module          | Endpoints                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | `POST /auth/otp/{request,verify}`, `POST /auth/refresh`, `POST /auth/logout`. Guards: `JwtGuard`, `RolesGuard('creator'\|'admin')`.                                                                                         |
| `users`         | `GET/PATCH /users/me`, `POST /users/me/become-creator` (requires `phone_verified`, locks `canonical_pricing_currency`), `POST /users/me/kyc/id`.                                                                            |
| `videos`        | `POST /videos` (presigned multipart upload), `POST /videos/:id/complete-upload`, `PATCH /videos/:id`, `POST /videos/:id/publish`, `GET /videos[/:id]`, `GET /videos/:id/playlist` (signed HLS URL if `checkAccess` allows). |
| `subscriptions` | `GET /subscriptions/plans` (priced in display currency), `POST /subscriptions`, `GET /subscriptions/me`, `POST /subscriptions/me/cancel`.                                                                                   |
| `payments`      | `POST /payments`, `POST /webhooks/{ecocash,zipit,paystack}` (idempotent).                                                                                                                                                   |
| `wallet`        | `GET /wallet/balance`, `GET /wallet/ledger`, `POST /wallet/payout`.                                                                                                                                                         |
| `watch`         | `POST /watch/sessions`, `POST /watch/sessions/:id/{heartbeat,end}`.                                                                                                                                                         |
| `search`        | `GET /search?q=&mode=` (Postgres FTS).                                                                                                                                                                                      |
| `fx`            | `GET /fx/rates`, cron `fx.refresh` (06:00 CAT daily), `POST /admin/fx/override`.                                                                                                                                            |
| `notifications` | Internal — WhatsApp → SMS → push. Events: payment_completed, subscription_renewing, payout_processed, new_video_from_followed.                                                                                              |

---

## 10. Code conventions

- **TypeScript everywhere** in `apps/api` + `apps/web`. No `any` — use `unknown` and narrow.
- **Zod for all runtime validation.** Bodies, query params, webhook payloads. Types derived (`z.infer<...>`).
- **No raw SQL in services** (repositories only).
- **No money math in components.** Pass `Money` instances; format only at the leaf.
- **Errors are typed.** Throw subclasses of `DomainError`; global filter maps to HTTP.
- **No global state.** NestJS DI only.
- **Idempotency on every network-crossing write.** Client-side `idempotency_key` for retryable mutations.
- **Structured logs** (pino) with `user_id`, `request_id`, `correlation_id`. No `console.log`.
- **Feature flags** for risky paths (admin toggle in DB, cached in Redis). Multi-currency starts feature-gated per currency.

### Workflow

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm --filter api migrate && pnpm --filter api seed
pnpm dev                       # turbo runs api (:3001) + web (:3000)
pnpm test && pnpm lint && pnpm typecheck
pnpm --filter api migrate:create <name>
```

Conventional Commits (`<type>(<scope>): <subject>`). `main` protected; feature branches `feat/<short-desc>`; squash merges only; CI green + 1 review required.

Env vars are documented in `.env.example`.

---

## 11. Milestones

Ship sequentially; do not skip ahead.

| #   | Goal                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- |
| M1  | Scaffold — monorepo, `/health`, Drizzle, CI. **Done.**                                                         |
| M2  | Auth — phone+OTP, JWT issue + rotate, `/users/me`.                                                             |
| M3  | Video lifecycle — presigned upload, FFmpeg transcode worker (240/480/720p HLS), publish.                       |
| M4  | Catalog + playback — list/search/play `free`, BunnyCDN signed URLs, thumbnails.                                |
| M5  | Access engine + paywall — `checkAccess` covers 16 (mode × auth × subbed × purchased) combos; admin fake-grant. |
| M6  | Payments + wallet — EcoCash USD/ZWG sandbox, idempotent webhooks, double-entry ledger.                         |
| M7  | FX provider — `fx_rates`, RBZ scraper + OXR, daily cron, admin override, `fx_holding` flow.                    |
| M8  | Subscriptions — plans/quote/checkout, auto-renew cron 02:00 CAT, 3-day grace.                                  |
| M9  | Creator studio — earnings dashboard, payout flow + min thresholds, video mgmt, analytics.                      |
| M10 | Premium pool payouts — monthly cron 01:00 CAT, bigint-safe proportional, idempotent.                           |
| M11 | Mobile parity — Flutter viewer: browse/search/play/paywall/EcoCash deep link/offline DLs/push.                 |

---

## 12. Out of scope (v1)

Do not implement without confirming with Adrian:

- Live streaming
- DRM beyond signed URLs
- Recommendations ML
- Comments / social
- Ads on free tier
- Stablecoin payouts
- Multi-region replication
- iOS app (Android-first; iOS in phase 2)
- Admin moderation UI beyond CLI
- Affiliate / referral
