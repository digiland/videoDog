# M8 — Subscriptions

**Goal (CLAUDE.md §14):** monthly subscription works end-to-end.

## Milestone acceptance

- Subscribe at $1.49/month USD → access all premium videos.
- Cancel → auto-renew off but access stays until `expires_at`.
- Renew → new payment, new ledger entries.
- ZWG-charged subscription stays locked in ZWG for the term.

## Tickets

### SZW-M08-001 — Migration 0007: subscription_plans + seed

**Goal:** Plans table (subscriptions table already exists from M5).
**Scope:**

- `infra/migrations/0007_subscription_plans.sql`:
  - `subscription_plans` per §9.
- Seed: `day_pass` (1 day, $0.99 USD), `week` (7 days, $1.19 USD), `month` (30 days, $1.49 USD).
- Drizzle schema.
  **Acceptance:**
- Migrate + seed; rows present.
  **Invariants:** §3.1, §3.5.
  **Depends on:** SZW-M01-009.

### SZW-M08-002 — GET /subscriptions/plans

**Goal:** List plans with prices quoted in viewer's display currency.
**Scope:**

- Fetches all `active = true` plans.
- For each: converts `base_price` (USD) to viewer's `preferred_display_currency` using current FX rate.
- Returns `{ id, code, duration_days, base_price: Money, display_price: Money, fx_rate_id }`.
- The `fx_rate_id` returned is the snapshot the viewer would be charged at if they subscribe immediately (display-only; actual charge re-resolves at POST per §3.5).
  **Acceptance:**
- Anonymous: USD prices.
- Auth'd viewer with `preferred_display_currency = ZWG`: ZWG-quoted prices.
  **Invariants:** §3.4, §3.5.
  **Depends on:** SZW-M08-001, SZW-M07-002.

### SZW-M08-003 — POST /subscriptions (checkout)

**Goal:** Initiate subscription purchase.
**Scope:**

- Body: `{ plan_id, payment_currency, provider }`.
- Creates `subscriptions` row in a pending-first-payment state (flag or null `started_at`).
- Locks `charged_amount_minor`, `charged_currency`, `usd_equivalent_minor`, `fx_rate_id` now.
- Creates `payments` row with `intent = 'subscription'`, `intent_ref_id = subscription_id`.
- Returns payment intent for the provider.
  **Acceptance:**
- On webhook confirmation (M6 handler extended):
  - Subscription `started_at = now()`, `expires_at = now() + duration_days`, `state = 'active'`.
  - Ledger: `Dr payment_received.<ccy> ; Cr premium_pool.USD <usd_equiv>` (with FX bridging via M7 if non-USD).
- Re-subscribing while already active extends `expires_at` (no double-bill — return existing row).
  **Invariants:** §3.1, §3.3, §3.6, §3.11.
  **Depends on:** SZW-M06-006, SZW-M07-008, SZW-M08-002.

### SZW-M08-004 — GET /subscriptions/me

**Goal:** Current sub status for the auth'd user.
**Scope:**

- Returns the active or most-recent subscription with state, plan, expires_at, auto_renew.
  **Acceptance:**
- No sub → `{ state: 'none' }`.
- Active → returns row.
  **Invariants:** none.
  **Depends on:** SZW-M05-001.

### SZW-M08-005 — POST /subscriptions/me/cancel

**Goal:** Disable auto-renew; access continues until expiry.
**Scope:**

- Sets `auto_renew = false`, `cancelled_at = now()`.
- Does NOT change `state` or `expires_at`.
  **Acceptance:**
- `checkAccess` still ok until `expires_at`.
- Renewal cron skips this row.
  **Invariants:** none.
  **Depends on:** SZW-M05-001.

### SZW-M08-006 — Subscription renewal BullMQ cron

**Goal:** Daily 02:00 CAT job that renews expiring subscriptions.
**Scope:**

- Find subs where `state = 'active' AND auto_renew = true AND expires_at < now() + 24h`.
- For each: re-quote plan price in `charged_currency` at current FX (per §3.6: re-quote at renewal).
- Create new `payments` row + provider intent.
- On confirmation: extend `expires_at`, snapshot new FX, write ledger entries.
- On failure: state → `past_due`.
  **Acceptance:**
- Active sub past expiry → new payment created.
- Auto-renew off → skipped.
  **Invariants:** §3.6, §3.11.
  **Depends on:** SZW-M08-003.

### SZW-M08-007 — Grace period state machine (past_due → expired)

**Goal:** Three-day grace before expiry.
**Scope:**

- Daily BullMQ job: subs in `past_due` for > 3 days → `expired`.
- Subs in `past_due` whose retry succeeds → `active`.
- Retry strategy: retry payment daily until success or grace expires.
  **Acceptance:**
- Failed renewal → `past_due` → retried → active or expired after 3 days.
- Access during `past_due`: still ok (graceful).
- Access after `expired`: not ok.
  **Invariants:** §3.9, §3.11.
  **Depends on:** SZW-M08-006.

### SZW-M08-008 — Renewal notifications

**Goal:** Notify viewers before renewal and on outcome.
**Scope:**

- T-3 days before `expires_at`: WhatsApp "your sub renews in 3 days for X".
- On successful renewal: receipt.
- On `past_due`: nudge to update payment method.
- Reuses M2's WhatsApp + SMS clients.
  **Acceptance:**
- Dev: log lines visible at correct times (use a faster cron for testing).
  **Invariants:** §3.13.
  **Depends on:** SZW-M02-001, SZW-M02-002, SZW-M08-006.
