# M9 — Creator studio

**Goal (CLAUDE.md §14):** creators have a real interface.

## Milestone acceptance

- Creator can see "this month: 12 PPV unlocks ($4.20), 340 watch-min from premium (est $1.85), 2 tips ($0.30) = $6.35 — request payout".
- Payout request creates a `payouts` row and a ledger entry debiting `creator_balance`.

## Tickets

### SZW-M09-001 — Migration 0008: payouts

**Goal:** Payout request table.
**Scope:**

- `infra/migrations/0008_payouts.sql`:
  - `payout_state` enum.
  - `payouts` per §9.
- Drizzle schema.
  **Acceptance:**
- Migrate.
  **Invariants:** §3.1, §3.4.
  **Depends on:** SZW-M01-009.

### SZW-M09-002 — Earnings dashboard endpoint

**Goal:** Aggregated monthly view of creator income.
**Scope:**

- `GET /studio/earnings?month=YYYY-MM` (defaults to current month, Africa/Harare).
- Computes from ledger:
  - PPV: sum of `creator_balance.USD` credits where `ref_type = 'purchase'` in window.
  - Tips: sum of credits where `ref_type = 'tip'` (reserved; tip feature not in MVP scope but slot stays).
  - Premium-pool **estimate**: estimated share of pool from current month's watch-minutes vs. total pool watch-minutes (snapshot at request time; final actuals from M10).
- Returns breakdown + total in creator's `preferred_payout_currency`.
  **Acceptance:**
- Numbers match the ledger.
- Window correct (calendar month, Africa/Harare).
  **Invariants:** §3.1, §3.5.
  **Depends on:** SZW-M06-003.

### SZW-M09-003 — POST /wallet/payout (with min threshold)

**Goal:** Creator requests a payout.
**Scope:**

- Body: `{ amount, currency, msisdn, idempotency_key }`.
- Validate `msisdn` E.164.
- Validate amount ≤ available balance in that currency.
- Min thresholds per §9: USD ≥ 500, ZWG ≥ 15000, ZAR ≥ 10000.
- Creates `payouts` row in `requested` state.
- Writes ledger entry: `Dr creator_balance.<ccy> ; Cr payout_pending.<ccy>` (system account seeded in M6).
  **Acceptance:**
- Under-threshold → 400.
- Over-balance → 400.
- Successful → row + ledger entries.
- Repeating idempotency_key → existing payout.
  **Invariants:** §3.1, §3.7, §3.8, §3.11, §3.13.
  **Depends on:** SZW-M06-003, SZW-M09-001.

### SZW-M09-004 — Payout processor worker (stub)

**Goal:** Worker that moves `requested → processing → completed/failed`.
**Scope:**

- For M9: stub the EcoCash payout API call (real integration is post-MVP — flag).
- On completion: `Dr payout_pending.<ccy> ; Cr external_clearing.<ccy>` (new system account, seeded by migration update).
- On failure: reverse with a balancing credit back to `creator_balance.<ccy>`, set `failure_reason`.
  **Acceptance:**
- Stub success path closes the ledger correctly.
- Stub failure path returns funds.
- Ledger remains balanced per currency through every path.
  **Invariants:** §3.7, §3.8, §3.11, §3.12.
  **Depends on:** SZW-M09-003.

### SZW-M09-005 — Web earnings dashboard

**Goal:** Studio page rendering the earnings breakdown.
**Scope:**

- `app/studio/earnings/page.tsx`.
- Month selector.
- Cards: PPV, premium pool estimate, tips, total.
- Payout request modal with inline threshold validation.
  **Acceptance:**
- Numbers match API.
- Threshold error shown inline.
  **Invariants:** §3.2.
  **Depends on:** SZW-M09-002, SZW-M09-003.

### SZW-M09-006 — Web video management table

**Goal:** Creator can manage their catalog.
**Scope:**

- `app/studio/videos/page.tsx`.
- Table columns: title, state, access_mode, ppv price, published_at, watch minutes (last 30d).
- Row actions: edit (PATCH /videos/:id), publish/unpublish, view stats.
  **Acceptance:**
- Edits persist.
- Publish/unpublish flips state and access immediately.
  **Invariants:** §3.5, §3.9.
  **Depends on:** SZW-M03-007, SZW-M03-008.

### SZW-M09-007 — Analytics: watch minutes per video

**Goal:** Per-video watch-time stats.
**Scope:**

- `GET /studio/videos/:id/analytics?from=&to=`.
- Returns daily watch minutes from `watch_minutes_daily` (M10 aggregator) — fallback to on-the-fly `watch_sessions` rollup if aggregator hasn't run yet for the window.
  **Acceptance:**
- Numbers match heartbeats.
  **Invariants:** §3.10.
  **Depends on:** SZW-M04-008.

### SZW-M09-008 — Conversion-rate analytics

**Goal:** Per-video conversion metric: views that ended in unlock.
**Scope:**

- Conversion = `count(distinct user_id in purchases for video)` ÷ `count(distinct user_id in watch_sessions for video)` over the window.
- Surface in `/studio/videos/:id/analytics`.
  **Acceptance:**
- Sensible numbers on seeded data.
  **Invariants:** §3.10.
  **Depends on:** SZW-M09-007.
