# M5 — Access engine + paywall

**Goal (CLAUDE.md §14):** all four access modes resolve correctly.

## Milestone acceptance

- All four modes work; switching `access_mode` flips access immediately for the same user.
- Unit test suite covers all 16 combinations of (mode × user-state).

## Tickets

### SZW-M05-001 — Migration 0004: purchases (+ subscriptions skeleton)

**Goal:** PPV unlock table, plus the minimum subscriptions table needed by `checkAccess`.
**Scope:**

- `infra/migrations/0004_purchases.sql`:
  - `purchase_state` enum.
  - `purchases` table per §9, including `UNIQUE (user_id, video_id)`.
  - `subscription_state` enum.
  - `subscriptions` table per §9 (full schema — M8 reuses, doesn't re-create).
- Drizzle schemas.
  **Acceptance:**
- Migrate; double-insert of `(user_id, video_id)` fails uniqueness.
- Inserting a subscription row with non-USD `charged_currency` succeeds without an `fx_rate_id` only if app layer allows it (require `fx_rate_id` for non-USD in app code).
  **Invariants:** §3.1, §3.4, §3.5, §3.6.
  **Depends on:** SZW-M01-009.
  **Notes:** Pulled `subscriptions` forward from M8 because `checkAccess` needs `isActive`. M8 adds `subscription_plans` + API + renewal cron on top of this.

### SZW-M05-002 — PurchasesService.exists

**Goal:** Repository method used by access check.
**Scope:**

- `PurchasesService.exists(userId, videoId): Promise<boolean>` — `state = 'completed'` only.
- Indexed lookup via `(user_id, video_id)`.
  **Acceptance:**
- Pending/refunded/failed purchases return false.
  **Invariants:** none.
  **Depends on:** SZW-M05-001.

### SZW-M05-003 — SubscriptionsService.isActive

**Goal:** Lightweight check used by access logic; full M8 fleshes out renewal.
**Scope:**

- `isActive(userId): Promise<boolean>` — true iff there's a row with `state = 'active'` AND `expires_at > now()`.
- Admin endpoint `POST /admin/subs/grant { user_id, expires_at, plan_id? }` writes a row for M5 testing (bypasses payments).
  **Acceptance:**
- `isActive(user_id)` returns true only if a granted row is unexpired.
- Granted then expired → returns false.
  **Invariants:** §3.6.
  **Depends on:** SZW-M05-001.

### SZW-M05-004 — VideosService.checkAccess

**Goal:** Single source of truth for view permission (§3.9).
**Scope:**

- Implements the algorithm in §7 exactly.
- Returns `{ ok: true }` or `{ ok: false, paywall }`.
- `paywall.options.subscribe.plans` includes plan quotes in the viewer's display currency (delegates to `quotePlans(currency)`; for M5 seed a single dummy plan).
- `paywall.options.buy.price` resolves from `videos.ppv_price_*` with display-currency conversion.
  **Acceptance:**
- Free → ok regardless of user.
- PPV + purchased → ok.
- PPV + unpurchased + subscribed → not ok (PPV is not in pool).
- Premium + subscribed → ok.
- Premium + unsubscribed → not ok.
- `premium_buyable` + subscribed → ok.
- `premium_buyable` + unsubscribed + purchased → ok.
- `premium_buyable` + unsubscribed + unpurchased → not ok, paywall offers both buy + subscribe.
  **Invariants:** §3.9.
  **Depends on:** SZW-M05-002, SZW-M05-003.

### SZW-M05-005 — GET /videos/:id returns real PaywallPayload

**Goal:** Replace M4 placeholder with the real check.
**Scope:**

- Refactor the M4 endpoint to call `checkAccess`.
- Same for `GET /videos/:id/playlist`: only return signed URL if `ok`; else 402 with paywall.
  **Acceptance:**
- M4 placeholder gone; real payload returned.
- Switching `access_mode` reflects on next request (no stale cache).
  **Invariants:** §3.9.
  **Depends on:** SZW-M05-004.

### SZW-M05-006 — Admin fake-grant purchase endpoint

**Goal:** Bypass payments for M5 testing.
**Scope:**

- `POST /admin/purchases/grant { user_id, video_id }`.
- Requires `role = 'admin'`.
- Inserts a `purchases` row with `state = 'completed'`, paid_amount = 0, currency = video's pricing currency.
- Idempotent (existing row → 200 no-op).
  **Acceptance:**
- After grant, viewer can play the video.
- Non-admin → 403.
  **Invariants:** §3.11.
  **Depends on:** SZW-M05-002.

### SZW-M05-007 — Web paywall UI (three states)

**Goal:** Render the three paywall variants.
**Scope:**

- `<Paywall payload={...} />` with three layouts:
  - `buy` only (PPV).
  - `subscribe` only (Premium).
  - Both (`premium_buyable`).
- Buttons stub out (no real payment until M6).
- Currency formatted via `Money.format`.
  **Acceptance:**
- All three layouts render with seeded test data.
- Mobile-responsive.
  **Invariants:** §3.2.
  **Depends on:** SZW-M05-005.

### SZW-M05-008 — 16-combo access matrix test suite

**Goal:** Exhaustive coverage of `checkAccess`.
**Scope:**

- Parameterized Vitest table: `{mode: 4} × {user-state: 4} = 16` rows, where user-state ∈ {anonymous, authed-none, authed-subbed, authed-purchased}.
- Each row asserts `ok` + correct paywall shape.
- Exhaustiveness check on the `access_mode` enum so adding a new mode forces table rows.
  **Acceptance:**
- All 16 rows pass.
- Adding a new mode without updating the table fails the build.
  **Invariants:** §3.9.
  **Depends on:** SZW-M05-004.
