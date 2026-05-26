# M6 — Payments + wallet

**Goal (CLAUDE.md §14):** real EcoCash money flows through to creator balances.

## Milestone acceptance

- In sandbox, buying a $0.50 PPV from a USD wallet credits the creator 35¢ in the ledger.
- Replaying the webhook does nothing (idempotent).
- Ledger trial balance is zero per currency at all times.

## Tickets

### SZW-M06-001 — Migration 0005: payments + accounts + ledger_entries

**Goal:** Payment + ledger schema.
**Scope:**

- `infra/migrations/0005_payments_ledger.sql`:
  - `payment_provider`, `payment_state`, `payment_intent` enums.
  - `payments` per §9 (unique `idempotency_key`, indexed `provider_ref`).
  - `accounts` per §9 with a partial unique index `WHERE scope = 'system'` on `(code, currency)` (system accounts singleton) and full unique on user-scoped.
  - `ledger_entries` per §9. Append-only enforced by a trigger that raises on UPDATE/DELETE, plus `REVOKE UPDATE, DELETE ON ledger_entries` from the app role.
  - Seed system accounts: `payment_received`, `fx_holding`, `premium_pool`, `platform_revenue`, `payout_pending` for each currency in scope (USD, ZWG, ZAR).
- Drizzle schemas.
  **Acceptance:**
- Migrate.
- `UPDATE ledger_entries SET ...` raises an error.
- `DELETE FROM ledger_entries WHERE id = '...'` raises an error.
  **Invariants:** §3.1, §3.7, §3.8.
  **Depends on:** SZW-M01-009.

### SZW-M06-002 — packages/ecocash client

**Goal:** Typed EcoCash USD + ZWG client.
**Scope:**

- `packages/ecocash/src/index.ts`:
  - `EcocashUsdClient.createCharge({ amount, phone, idempotency_key })`.
  - `EcocashZwgClient` — same shape, different endpoint/creds.
  - Webhook signature verifier (HMAC over canonical payload using `ECOCASH_WEBHOOK_SECRET`).
- Dev stub mode (deterministic provider_ref + auto-success); sandbox mode hitting EcoCash sandbox URLs.
  **Acceptance:**
- Unit tests cover happy path + signature verification (valid/invalid).
  **Invariants:** §3.11.
  **Depends on:** SZW-M01-004.

### SZW-M06-003 — LedgerService primitives

**Goal:** Append-only double-entry ledger helpers.
**Scope:**

- `LedgerService.recordTransaction(entries: LedgerEntry[])`:
  - Asserts `sum(debit) == sum(credit) per currency` within the transaction.
  - Asserts every entry has `usd_equivalent_minor` and (if non-USD) `fx_rate_id`.
  - Inserts in a single DB transaction with a fresh `transaction_id` UUID.
- `LedgerService.balance(account_id, asOf?)`.
- `LedgerService.trialBalance(currency)`: returns 0 if everything is consistent.
- Typed errors: `LedgerImbalanceError`, `LedgerCrossCurrencyError`.
  **Acceptance:**
- Tests cover: balanced single-currency tx, imbalanced (rejected), cross-currency tx in one transaction (rejected), trial balance always zero per currency after any number of valid transactions.
  **Invariants:** §3.3, §3.7, §3.8.
  **Depends on:** SZW-M06-001.

### SZW-M06-004 — Auto-provision user accounts on first credit

**Goal:** Implicitly create user-scoped accounts when first crediting them.
**Scope:**

- `LedgerService.findOrCreateAccount({ scope, owner_id, code, currency })`.
- System accounts already seeded by migration; user-scoped (`creator_balance`) created on first credit.
  **Acceptance:**
- First credit to a new creator's `creator_balance.USD` succeeds.
- Repeated credits use the same account row.
  **Invariants:** §3.7.
  **Depends on:** SZW-M06-003.

### SZW-M06-005 — POST /payments (intent creation)

**Goal:** Initiate a payment for purchase / subscription / tip / topup.
**Scope:**

- Body: `{ intent, intent_ref_id, provider, amount: Money, idempotency_key }`.
- For `intent = 'purchase'`: amount must equal the video's PPV price in the chosen currency, with FX snapshot per §3.4 (M6 scope: USD-only flow works; non-USD FX bridging lands in M7).
- Inserts `payments` row in `initiated` state.
- Calls provider client; updates state → `pending`, stores `provider_ref`.
- Returns `{ payment_id, provider_ref, action: 'awaiting_callback' }`.
  **Acceptance:**
- Repeating same `idempotency_key` → existing payment, not a new row.
- Amount mismatch with video price → 400.
  **Invariants:** §3.1, §3.4, §3.5, §3.11.
  **Depends on:** SZW-M06-002, SZW-M06-003.

### SZW-M06-006 — POST /webhooks/ecocash (idempotent)

**Goal:** Process EcoCash callbacks; commit ledger on success.
**Scope:**

- Verify HMAC signature with `ECOCASH_WEBHOOK_SECRET`.
- Look up payment by `provider_ref`.
- If already terminal and matches the callback → 200 no-op.
- Per §3.12: reconcile by calling EcoCash status API; trust reconcile over the raw callback.
- On confirmed success:
  - Update `payments.state = 'completed'`, store `raw_callback`.
  - For `intent = 'purchase'`: mark `purchases.state = 'completed'`; record ledger transaction (USD-only in M6):
    - `Dr payment_received.USD = paid` ; `Cr creator_balance.USD = paid * 0.70` ; `Cr platform_revenue.USD = paid * 0.30`.
- Always 200 once verified so EcoCash doesn't retry forever.
  **Acceptance:**
- Two callbacks with same `provider_ref` → only one ledger transaction.
- Failed reconcile (provider says still pending) → no state change.
- Sandbox: $0.50 PPV USD → creator 35¢, platform 15¢, ledger sums to zero.
  **Invariants:** §3.7, §3.8, §3.11, §3.12.
  **Depends on:** SZW-M06-005, SZW-M06-004.

### SZW-M06-007 — Wallet endpoints

**Goal:** Read APIs for balances and ledger entries.
**Scope:**

- `GET /wallet/balance` → `{ balances: [{ currency, amount_minor }] }` across the auth'd user's accounts.
- `GET /wallet/ledger?from=&to=&cursor=&limit=` → paginated entries.
- Both gated on auth.
  **Acceptance:**
- Balance reflects ledger entries.
- Ledger query paginates correctly.
  **Invariants:** §3.1.
  **Depends on:** SZW-M06-003.

### SZW-M06-008 — Web: paywall buy button → real payment

**Goal:** Wire the M5 paywall buy button to a real EcoCash purchase.
**Scope:**

- Buy button → modal: EcoCash wallet choice (USD/ZWG) + phone.
- POST to `/payments` with `intent=purchase`.
- Poll `/videos/:id` for `access_check_result.ok` (polling acceptable for M6; SSE later).
- On success, refresh and play.
  **Acceptance:**
- Sandbox: viewer clicks buy → completes EcoCash flow → video unlocks.
  **Invariants:** §3.11.
  **Depends on:** SZW-M06-005, SZW-M06-006.

### SZW-M06-009 — Trial-balance invariant test

**Goal:** Property test that ledger always balances per currency.
**Scope:**

- Vitest `afterEach` for the payments suite asserts `LedgerService.trialBalance(currency) === 0n` for every currency present.
- Includes a negative test: deliberately injecting an imbalanced tx fails the invariant.
  **Acceptance:**
- All payment tests pass with the invariant green.
- Negative test fails as expected.
  **Invariants:** §3.7, §3.8.
  **Depends on:** SZW-M06-006.
