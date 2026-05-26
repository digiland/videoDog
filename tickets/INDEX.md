# StreamZW Tickets — MVP

Work breakdown for milestones M1–M11 per [../CLAUDE.md](../CLAUDE.md). One ticket per atomic unit; one file per milestone.

## Conventions

- **ID:** `SZW-M{milestone:02}-{seq:03}` — e.g. `SZW-M01-007`.
- **Status:** Open / In-progress / Blocked / Done. Track in your board or commit trailers, not here — this folder is the spec, not the tracker.
- **Order:** Tickets within a milestone are listed in suggested build order. `Depends on:` calls out hard dependencies (in-milestone or cross-milestone).
- **Invariants:** Every ticket lists the CLAUDE.md §3 invariants it must respect. Code that breaks one does not merge.
- **Acceptance:** Each ticket's acceptance criteria are the merge gate. The milestone-level acceptance criteria (from CLAUDE.md §14) sit at the top of each file as a parent gate.

## Milestones

| File                                                       | Milestone                    | One-line goal                              | Tickets |
| ---------------------------------------------------------- | ---------------------------- | ------------------------------------------ | ------- |
| [M01-scaffold.md](M01-scaffold.md)                         | M1 — Scaffold                | Monorepo runs end-to-end with healthcheck  | 11      |
| [M02-auth.md](M02-auth.md)                                 | M2 — Auth                    | Phone + OTP sign-in with rotating JWTs     | 11      |
| [M03-video-lifecycle.md](M03-video-lifecycle.md)           | M3 — Video lifecycle         | Upload → transcode → publish HLS           | 9       |
| [M04-catalog-playback.md](M04-catalog-playback.md)         | M4 — Catalog + playback      | Public browse, search, watch free videos   | 12      |
| [M05-access-paywall.md](M05-access-paywall.md)             | M5 — Access engine + paywall | All four access modes gated correctly      | 8       |
| [M06-payments-wallet.md](M06-payments-wallet.md)           | M6 — Payments + wallet       | EcoCash → ledger → creator balance         | 9       |
| [M07-fx-provider.md](M07-fx-provider.md)                   | M7 — FX provider             | Real multi-currency via `fx_holding`       | 9       |
| [M08-subscriptions.md](M08-subscriptions.md)               | M8 — Subscriptions           | Recurring billing with grace period        | 8       |
| [M09-creator-studio.md](M09-creator-studio.md)             | M9 — Creator studio          | Earnings, payouts, video management UI     | 8       |
| [M10-premium-pool-payouts.md](M10-premium-pool-payouts.md) | M10 — Premium pool payouts   | Monthly pool distribution by watch minutes | 5       |
| [M11-mobile-parity.md](M11-mobile-parity.md)               | M11 — Mobile parity          | Flutter app with offline downloads         | 10      |

**Total:** ~100 tickets across 11 milestones.

## Status (2026-05-26)

All milestones **Open**. Active milestone: **M1**. Start with [SZW-M01-001](M01-scaffold.md#szw-m01-001--initialize-pnpm-monorepo).

## Ticket template

When splitting a ticket or adding a new one, follow this format:

```markdown
### SZW-M{NN}-{NNN} — Short title

**Goal:** One sentence — what this ticket delivers.
**Scope:**

- Concrete deliverables (files, endpoints, jobs).
- One bullet per deliverable.
  **Acceptance:**
- Testable conditions — what makes this mergeable.
  **Invariants:** §3.N, §3.M (list applicable IDs)
  **Depends on:** SZW-M{NN}-{NNN}, … (or "none")
  **Notes:** (optional) — open questions, references, deferred decisions.
```

## Open questions before starting M1

Flagged during the kickoff review — need a yes/no before scaffolding:

1. **Drizzle ORM with SQL-first migrations** (overrides the stray "TypeORM or Drizzle" mention in §10) — confirm.
2. **Migration tool:** default to **node-pg-migrate** unless Atlas is preferred — confirm.
3. **`otp_challenges` has no `updated_at`** — intentional. Confirm.
4. **`Money.format` canonical strings:** `$1.49`, `ZWG 44.70`, `R 27.80`, plus `€` and `£` for phase 2 — confirm.
5. **`canonical_pricing_currency` is written exactly once at first publish**, never editable after — confirm.

Tickets assume the defaults above. If anything flips, the relevant ticket gets revised.

## Cross-cutting concerns

These are baseline per CLAUDE.md §13 and folded into whichever milestone first needs them — not separate tickets:

- Structured logs (pino) with `user_id`, `request_id`, `correlation_id` — landed in M1.
- Typed errors via `DomainError` hierarchy — landed in M1.
- Zod validation on every request body, query param, and webhook payload — used from M2 onward.
- Idempotency keys on cross-network mutations — first enforced in M6.
- Feature flags for risky paths — first used in M7 (per-currency gating).
