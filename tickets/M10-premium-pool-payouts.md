# M10 — Premium pool payouts

**Goal (CLAUDE.md §14):** monthly cron distributes the premium pool.

## Milestone acceptance

- Seed 3 creators with mixed watch-minutes → run the job → ledger entries created, sum equals pool exactly (no rounding leakage).
- Re-running the job produces no new entries.

## Tickets

### SZW-M10-001 — Nightly watch_minutes_daily refresh job

**Goal:** Aggregate `watch_sessions` into `watch_minutes_daily` for the previous day.
**Scope:**

- BullMQ daily cron 00:30 CAT.
- For yesterday: sum minutes per `video_id`, upsert into `watch_minutes_daily`.
- Counts only minutes accumulated from heartbeats (per §3.10).
- Counts all videos, not just `in_premium_pool` — filter at distribution time.
  **Acceptance:**
- Yesterday's heartbeats → corresponding rows in `watch_minutes_daily`.
- Re-running for the same date is a no-op (upsert with conflict-do-update on a stable hash, or use `INSERT ... ON CONFLICT DO UPDATE` where the new value equals the old).
  **Invariants:** §3.10.
  **Depends on:** SZW-M04-008.

### SZW-M10-002 — `payouts.calculate_premium_pool` job

**Goal:** Monthly job — day 1 at 01:00 CAT — distributes prior month's pool.
**Scope:**

- BullMQ Repeat job, timezone `Africa/Harare`, cron `0 1 1 * *`.
- Per §8 (Premium pool):
  1. Sum subscription revenue in USD for the target month from ledger (credits to `premium_pool.USD` from `ref_type = 'subscription'`).
  2. `pool = subs_revenue × 0.55`.
  3. Aggregate watch-minutes from `watch_minutes_daily` filtered to `in_premium_pool = true` videos for the month.
  4. Distribute proportionally to creators via the largest-remainder helper (SZW-M10-003).
- Each per-creator distribution = one ledger transaction.
- `ref_type = 'premium_payout'`, `ref_id` references a `premium_payout_runs` row keyed by `(year, month)`.
  **Acceptance:**
- Seeded scenario (3 creators with 1000/500/250 watch-min, pool = $10) → A=$5.71, B=$2.86, C=$1.43 (last cent assigned to largest by largest-remainder).
- Sum of distributed = pool exactly.
  **Invariants:** §3.7, §3.8, §3.11.
  **Depends on:** SZW-M10-001, SZW-M10-003, SZW-M10-004.

### SZW-M10-003 — Largest-remainder distribution helper

**Goal:** Bigint-safe proportional allocator with zero rounding leakage.
**Scope:**

- `packages/shared/src/allocate.ts`:
  - `allocate(total: bigint, weights: bigint[]): bigint[]` — shares sum exactly to `total`.
  - Method: integer division for base share + largest-remainder for leftover.
  - Deterministic tiebreak (by index).
- Vitest covers: zero weights, single weight, total < weight count, values above `Number.MAX_SAFE_INTEGER`.
  **Acceptance:**
- Property test: `sum(allocate(total, weights)) === total` for random inputs.
  **Invariants:** §3.1.
  **Depends on:** SZW-M01-005.

### SZW-M10-004 — Idempotency guard for monthly job

**Goal:** Re-running the job for the same month is a no-op.
**Scope:**

- `premium_payout_runs` table: `(year, month, started_at, completed_at)` primary key on `(year, month)`. Added as `infra/migrations/0009_premium_payout_runs.sql`.
- Job checks the row before running; if `completed_at` is set → exit.
- Job writes `completed_at` at the end of a successful run, inside the same DB transaction as the last ledger entry — partial failures leave `completed_at` null.
  **Acceptance:**
- Two runs for same month → only one set of ledger entries.
- Crash mid-run leaves no `completed_at`; manual cleanup script (`pnpm --filter api premium-pool:retry --month=...`) clears partial entries before retry — document in `docs/RUNBOOK.md`.
  **Invariants:** §3.7, §3.11.
  **Depends on:** SZW-M10-002.
  **Notes:** Mid-run resumability not in scope; spec says re-runs are a no-op on success. Crash recovery is a manual op.

### SZW-M10-005 — Verification harness

**Goal:** Integration tests + property tests for ledger invariants on the monthly job.
**Scope:**

- Vitest integration test: seed users, subs, videos, `watch_minutes_daily` → run job → assert:
  - `LedgerService.trialBalance(currency) === 0n` for every currency present.
  - Sum of `premium_pool.USD → creator_balance.USD` credits equals 55% of subscription revenue.
- Property test with randomized seeds; same assertions.
  **Acceptance:**
- All tests green.
- Mutating the allocator to leak a cent makes a test fail.
  **Invariants:** §3.1, §3.7, §3.8.
  **Depends on:** SZW-M10-002, SZW-M10-003.
