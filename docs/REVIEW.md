# StreamZW — implementation review (2026-05-26)

Review of `apps/`, `packages/`, `infra/` against `tickets/M01–M10` and the §3 invariants in [CLAUDE.md](../CLAUDE.md). M11 (Flutter) is deferred per memory.

## TL;DR

Schema, `Money`, double-entry ledger (with append-only triggers + per-currency balance), `AccessService.checkAccess`, and the paywall payload shape are all in good shape. The pipes between modules are leaky:

- **No worker / cron is started anywhere** — transcoding, FX refresh, premium-pool distribution, subscription renewal all defined but unreachable.
- **PPV purchase has no creation endpoint** — a viewer literally cannot buy a video; only admin grants insert `purchases`.
- **Subscriptions activate before payment confirms** — bypasses payment, violates §3.11 expectations.
- **Refresh-token rotation links to the wrong row** — false reuse-attack alerts on any user with ≥2 live sessions.
- **Watch heartbeats count each ~15s heartbeat as a whole minute** — analytics are 4× reality.
- **Wallet ledger history query is unsatisfiable for users with ≥2 accounts** (returns empty).
- **Float math on money** in subscription FX and `Money.toUsdEquivalent`.

Treat M3 / M6 / M7 / M8 / M9 / M10 as **partial** — controllers and DB look right, but the runtime never executes the critical paths.

---

## 1. Critical bugs

| #   | Where                                                                        | What                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/api/src/modules/auth/auth.service.ts` ~L90–108                         | After `issueTokens`, "find new token" query orders by `created_at ASC` and picks the oldest live row → `rotated_to` links wrong. Return the new id from `issueTokens` and use directly.          |
| 2   | `apps/api/src/modules/auth/auth.service.ts` L77                              | `bcrypt.hash(rawRefreshToken)` computed then discarded with `void hash`. Dead. Remove.                                                                                                           |
| 3   | `apps/api/src/modules/wallet/wallet.service.ts` L68                          | `and(...accountIds.map(eq))` — unsatisfiable. Use `inArray(ledgerEntries.accountId, ids)`.                                                                                                       |
| 4   | `apps/api/src/modules/subscriptions/subscriptions.service.ts` L113           | Inserts subscription with `state: 'active'` before payment confirms. Needs `pending` → `active` after webhook.                                                                                   |
| 5   | `apps/api/src/modules/subscriptions/subscriptions.service.ts` L41–42, L97–98 | `BigInt(Math.round(Number(amount) * parseFloat(rate)))` — float math on money (§3.1, §3.2).                                                                                                      |
| 6   | `packages/shared/src/money.ts` `toUsdEquivalent`                             | Same float path — `parseFloat(rate)` then `Number(amount) * rate`. Use bigint-scaled multiply.                                                                                                   |
| 7   | `apps/api/src/workers/*.worker.ts` + `apps/api/src/main.ts`                  | Workers are factory functions; nothing instantiates them. No BullMQ workers run, no crons scheduled. M3/M7/M8/M10 jobs non-functional.                                                           |
| 8   | `apps/api/src/modules/payments/payments.controller.ts` L24                   | `JSON.stringify(body)` re-serialises a parsed body and HMAC-verifies that. Use raw body bytes (Nest `express.raw()` for webhook routes).                                                         |
| 9   | `apps/api/src/integrations/ecocash.ts` L46/77                                | `ECOCASH_WEBHOOK_SECRET` defaults to `''`. Refuse to boot in production.                                                                                                                         |
| 10  | `apps/api/src/modules/payments/payments.service.ts` ~L177                    | Updates `purchases` by `payment.intentRefId`, but no endpoint creates the `purchases` row in the first place. Only admin grants insert. Add `POST /purchases` (pending) before `POST /payments`. |
| 11  | `apps/api/src/workers/premium-pool.worker.ts` L38–41                         | `INSERT ... ON CONFLICT DO NOTHING` then iterate. Crash mid-iteration → retry finds `completedAt = null` → double-pays. Use per-`(year,month,video_id)` idempotency rows or `SELECT FOR UPDATE`. |
| 12  | `apps/api/src/modules/watch/watch.service.ts` L46–55                         | Every heartbeat (10–25s) adds **1 minute** to `minutes_watched`. Should accumulate seconds then `/60`, or only increment every 4 heartbeats. Currently 4× inflated.                              |
| 13  | `apps/api/src/modules/payments/payments.service.ts` ~L483                    | Tip handling only runs when `paid_currency === 'USD'`. Non-USD tips leave payment `completed` with **no ledger entries** — silent money loss.                                                    |

## 2. Likely bugs / risky

- `videos.controller.ts` L79 and `videos.service.ts` L166 hardcode `preferredDisplayCurrency: 'USD'` — paywall always quotes USD for ZWG viewers.
- `OtpService.verify` reads `attempts` then writes `attempts + 1`. Two concurrent verifies double-count. Use atomic `UPDATE … WHERE attempts < MAX RETURNING`.
- `videos.service.ts` L188 casts `filters.mode` (string) straight to enum. Validate via Zod.
- Pagination cursor: `list()` returns `next_cursor` but never consumes it on the next call — same top page forever.
- `Money.toUsdEquivalent` assumes the rate is `(currency → USD)`. If `fx_rates` is seeded `USD → ZWG` only, the reverse lookup 404s.
- `transcode.worker.ts` only outputs 240/480/720. Spec / M3 lists **1080**.
- `subscriptions.service.cancel` leaves `cancelledAt` set on re-subscribe.

## 3. Unclean code

- **Convention drift** — CLAUDE.md §9 says raw SQL only in `*.repository.ts`. Zero repo files exist; services use Drizzle directly.
- **Type holes** — `as any` on BullMQ connection options ×5, `payload as any` in `jwt.service.ts`. Replace with `ConnectionOptions` from `bullmq` and a typed JWT claims interface.
- **Duplicated `CURRENCY_CODES`** in `users.service.ts`, `videos.service.ts` (twice), `fx.controller.ts`, `users.controller.ts`. Single source of truth lives in `@streamzw/shared`.
- **Duplicate "is active sub" query** — `AccessService.isActiveSubscriber`, `SubscriptionsService.isActive`, `SubscriptionsService.getCurrent`.
- **Mixed validation locations** — most services run `safeParse(body)` inline; should be a controller-level `ZodValidationPipe`.
- **Float-on-money in web inputs** — `apps/web/app/studio/upload/page.tsx` L80 and `studio/videos/page.tsx` L103: `Math.round(parseFloat(x) * 100)`. Bounded but the pattern leaks across.
- **`process.env.NODE_ENV !== 'production'` branches in OTP clients** are convenient for dev but should be gated by an explicit `DEV_LOG_OTP=true`.
- **Dead webhook stubs** for ZIPIT/Paystack (acceptable as stubs — flag explicitly).

## 4. Ticket coverage

| M   | Done                                                      | Partial                                                                                   | Missing                                            |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| M2  | OTP, JWT issue, logout                                    | refresh rotation (linkage bug)                                                            | `/users/me/kyc/id`, encrypted `national_ids` table |
| M3  | upload, transcode pipeline code                           | 1080p; workers defined but never started                                                  | runtime worker bootstrap                           |
| M4  | list, search, free playback                               | pagination cursor unused; thumbnails                                                      | trending sort, view counts                         |
| M5  | `checkAccess`, paywall, admin grants                      | display currency not propagated                                                           | —                                                  |
| M6  | intents, EcoCash sandbox call, ledger, idempotency UNIQUE | webhook signature on re-serialised body; non-USD tips drop; no purchase-creation endpoint | reconcile-on-state-transition; ZIPIT / Paystack    |
| M7  | RBZ scraper, OXR client, override, `fx_holding` flow      | float in FX math; no cron                                                                 | 06:00 CAT `fx.refresh` schedule                    |
| M8  | plans seed, GET plans, checkout, `/me`, cancel            | float FX; subscription active pre-payment                                                 | renewal cron, `past_due` grace, notifications      |
| M9  | studio earnings, analytics, payouts table + request       | wallet ledger empty for ≥2 accounts; payout USD-only                                      | non-USD payout path, payout processor              |
| M10 | premium-pool worker logic                                 | non-atomic idempotency                                                                    | monthly cron at 01:00 CAT                          |

## 5. Suggested fix order (one PR per row)

1. Refresh-token linkage + wallet ledger query — both one-line bugs that corrupt user-facing state.
2. Watch heartbeat math + workers bootstrap (`main.ts` start workers and `@Cron` jobs).
3. Purchase-creation endpoint + subscription pending-state machine.
4. Webhook raw-body verification + production env-var enforcement.
5. Money: kill `parseFloat(rate)` everywhere; rate as scaled bigint.
6. Premium-pool atomic idempotency.
7. Currency propagation through paywall.
8. Sweep — `as any`, duplicated `CURRENCY_CODES`, repository extraction.
