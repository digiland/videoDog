# M7 — FX provider

**Goal (CLAUDE.md §14):** multi-currency works for real.

## Milestone acceptance

- A viewer paying in ZWG for a USD-priced video → payment in ZWG; ledger has the two-transaction pattern from §6; creator balance grows in USD.
- Admin override changes the rate used by the next payment.

## Tickets

### SZW-M07-001 — Migration 0006: fx_rates

**Goal:** FX rate storage with priority and effective windows.
**Scope:**

- `infra/migrations/0006_fx.sql`:
  - `fx_rates` per §9.
  - Partial unique index on `(base, quote, source)` where `effective_until IS NULL` — prevents two open rows for same source/pair.
  - Lookup index per §9.
- Drizzle schema.
  **Acceptance:**
- Migrate; double-insert of open row from same source fails.
  **Invariants:** §3.4.
  **Depends on:** SZW-M01-009.

### SZW-M07-002 — packages/fx with rate resolver

**Goal:** `FxService.rate(base, quote, at?)` per §6's resolution algorithm.
**Scope:**

- Queries `fx_rates` ordered by `source_priority desc, fetched_at desc`.
- Returns `{ id, rate, source }` — `id` is the snapshot reference for §3.4.
- Typed `FxRateUnavailableError` if no rate found.
- Identity rates (e.g. USD→USD) synthesized on the fly; no DB row needed.
- Redis-cache result for 5 min keyed by `(base, quote, day)`.
  **Acceptance:**
- Two overlapping rows resolve to higher priority.
- Admin override (100) wins over RBZ (50) wins over OXR (10).
- Missing pair → typed error.
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-001.

### SZW-M07-003 — RBZ scraper

**Goal:** Daily fetch of RBZ official ZWG↔USD rate.
**Scope:**

- HTTP fetch + HTML parse (cheerio).
- Inserts a new row with `source='rbz'`, `source_priority=50`; sets `effective_until = now()` on the previously open RBZ row for that pair.
- Logs the raw payload in `notes` for audit.
  **Acceptance:**
- Manual run against live RBZ URL → new row inserted.
- Parse failure → no row inserted, structured error log.
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-001.

### SZW-M07-004 — Open Exchange Rates client

**Goal:** Fallback FX provider for non-Zim pairs (ZAR, EUR, GBP).
**Scope:**

- HTTP client using `OPENEXCHANGERATES_APP_ID`.
- Fetches latest USD-base rates; inserts rows for `USD↔ZAR`, `USD↔EUR`, `USD↔GBP` with `source_priority=10`.
  **Acceptance:**
- Manual run → rows present.
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-001.

### SZW-M07-005 — fx.refresh BullMQ cron

**Goal:** Daily 06:00 CAT job that runs both providers.
**Scope:**

- BullMQ Repeat job, timezone `Africa/Harare`.
- Runs RBZ + OXR in parallel; failures isolated (RBZ failing doesn't kill OXR).
- Sets `effective_until` on previously-open rows for the same `(source, base, quote)` when inserting new.
  **Acceptance:**
- Manual trigger → new rows for all pairs.
- Re-running same day is safe (one new row per source per pair).
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-003, SZW-M07-004.

### SZW-M07-006 — Admin POST /admin/fx/override

**Goal:** Manual rate override that wins over scraped sources.
**Scope:**

- Body: `{ base, quote, rate, effective_until?, notes }`.
- Requires `role = 'admin'`.
- Inserts row with `source='manual'`, `source_priority=100`.
- `effective_until` not set → override open-ended until another override or manual cleanup.
  **Acceptance:**
- After override, `FxService.rate(base, quote)` returns the new rate.
- Override expires at `effective_until` → resolution falls back to RBZ/OXR.
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-002.

### SZW-M07-007 — GET /fx/rates (with cache)

**Goal:** Public read endpoint for display-currency conversion in UI.
**Scope:**

- `?base=USD&quote=ZWG` → `{ rate, source, fetched_at, effective_from }`.
- Cached 5 min in Redis.
  **Acceptance:**
- Returns current rate; cache hit visible in logs on second call.
  **Invariants:** §3.4, §3.5.
  **Depends on:** SZW-M07-002.

### SZW-M07-008 — Multi-tx FX flow for non-USD payments

**Goal:** Implement the two-transaction ledger pattern from §6 for foreign-currency receipts.
**Scope:**

- `PaymentSettlementService` on top of `LedgerService`:
  - Tx 1 — Receipt: `Dr payment_received.<ccy> ; Cr fx_holding.<ccy>` (paid_amount).
  - Tx 2 — FX → canonical: `Dr fx_holding.USD ; Cr creator_balance.USD * 0.70 ; Cr platform_revenue.USD * 0.30` (usd_equivalent).
- Both transactions reference the same `fx_rate_id` snapshot.
- EcoCash ZWG webhook handler updated to route through this.
  **Acceptance:**
- ZWG 1485 payment for $0.50 PPV → both ledger transactions exist, balanced per currency, creator earns USD 35¢.
- `fx_holding.ZWG` accumulates ZWG; `fx_holding.USD` is net-flat per payment.
  **Invariants:** §3.1, §3.3, §3.4, §3.7, §3.8.
  **Depends on:** SZW-M06-006, SZW-M07-002.

### SZW-M07-009 — Money.toUsdEquivalent wiring

**Goal:** Connect the shared Money helper to live FxService.
**Scope:**

- API-side helper `convertToUsd(money: Money): Promise<{ usd: Money, fxRateId: string }>` that resolves the current rate, snapshots the id, and returns both.
- Used by `POST /payments` to populate `usd_equivalent_minor` + `fx_rate_id` at payment creation.
  **Acceptance:**
- `POST /payments` with non-USD amount → row has correct USD equivalent and a non-null `fx_rate_id`.
  **Invariants:** §3.4.
  **Depends on:** SZW-M07-002.
