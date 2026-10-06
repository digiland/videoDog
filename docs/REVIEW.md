# StreamZW — implementation review (2026-05-26)

> **Status update (2026-10-06).** The money-path fixes below landed together, with
> integration tests against real Postgres (`apps/api/src/**/*.int.test.ts`, run in CI).
> Items marked ✅ are fixed; the original review follows unchanged for history.
>
> - ✅ Build: `main` compiles again (missing `Inject` import, `FxService` injection, `@nestjs/schedule` dependency); web and shared lint pass.
> - ✅ Payment amounts are server-derived: `POST /payments` charges the pending purchase/subscription the caller owns; only tips take a client amount. Provider must match the charge currency; ZIPIT/Paystack are refused until implemented.
> - ✅ Webhook settlement is one DB transaction with the payment row `FOR UPDATE`: concurrent duplicates settle once, a crash part-way rolls back for the retry. Signature is checked over the raw body with the payment's own provider; production refuses to boot without `ECOCASH_WEBHOOK_SECRET`.
> - ✅ Tips credit the creator (90/10) in any currency; a second payment for an already-unlocked video is booked to `refunds_due`, not double-credited.
> - ✅ Payouts: balance check + debit under an advisory lock; always paid to the profile's `payout_msisdn`; ZWG/ZAR payouts convert from `creator_balance.USD` through `fx_holding`.
> - ✅ Subscription renewals actually charge the provider (stored `payer_msisdn`), retry daily through the 3-day grace, and never stack a charge on an open attempt.
> - ✅ Premium pool: 45% of subscription revenue now moves to `platform_revenue` in the same transaction as the 55% creator split; CAT month boundaries; deterministic odd-cent allocation; daily `watch.aggregate` job is now scheduled (nothing enqueued it before, so the pool paid nobody).
> - ✅ Watch time: 4 counted heartbeats = 1 minute, via one conditional UPDATE (no double-count under concurrency).
> - ✅ Refresh tokens: rotation claimed atomically; reuse revokes the whole forward chain.
> - ✅ BullMQ connections now honour `REDIS_URL` (ioredis has no `url` option, so every queue was silently on localhost).
> - ✅ System ledger accounts are unique even with `owner_id IS NULL` (migration 0013).
>
> **Second pass (same day): remaining items + video playback.**
>
> - ✅ §3.12 reconciliation: one locked settle path for webhooks, `GET /payments/:id` polls and a 5-minute sweep that asks the provider about stale payments.
> - ✅ Payout processor (every 10 min): atomic claim → EcoCash disbursement → ledger completion, or full reversal on rejection; unknown outcomes held for manual reconciliation. ZAR payouts refused until a rail exists.
> - ✅ Payout number changes require a fresh OTP (`POST /users/me/payout-msisdn`); OTP attempts are counted atomically and codes are single-use; dev OTP logging needs `DEV_LOG_OTP=true`.
> - ✅ Paystack card rail (ZAR/USD) with signed webhooks and verify-before-settle (amount and currency must match).
> - ✅ National IDs AES-256-GCM encrypted in `national_ids` with HMAC dedupe; admin verification sets `id_verified` (§3.15).
> - ✅ FX: rates are stored USD→X, so X→USD lookups failed — every non-USD payment errored. Lookups now use the reverse pair and cross pairs go through USD.
> - ✅ Paywall quotes the viewer's display currency (render-only); creators must price in their canonical currency (§3.5).
> - ✅ Search: no longer returns raw rows (storage keys leaked); web search had always shown "No results" (`items` vs `results`); `/videos?q=` works; pagination cursor works.
> - ✅ Raw SQL lives in `*.repository.ts`; aggregates use typed Drizzle helpers; shared `CURRENCY_CODES`; no `as any`.
> - ✅ Resumable multipart uploads (8 MiB parts) for creators on mobile data.
>
> **Video playback** (end-to-end tested: upload → transcode → paywall → EcoCash purchase → HLS decode):
>
> - ✅ Transcoded videos could not play: only the master playlist was presigned, so renditions and segments in the private bucket returned 403. Playback grants are now a BunnyCDN directory token or API-served playlists (`/playback/:id/:token/…`) with presigned segments.
> - ✅ Subscribers, buyers and owners always saw the paywall: the video page checked access server-side without the user's token. The paywall's buy/subscribe links pointed to pages that didn't exist, and subscribing never took payment. The web app now has a working EcoCash checkout.
> - ✅ The player never sent heartbeats (`id` vs `session_id`), so no watch time was recorded and the premium pool could never pay out.
> - ✅ Watch sessions require access, one live stream per viewer, creators' own views excluded from pool minutes.
> - ✅ Drafts are hidden from non-owners; storage keys are no longer in video JSON.
> - ✅ Transcoder: single ffmpeg pass, 240/480/720/1080p without upscaling, aligned keyframes, CODECS in master, 64 kbps audio on low renditions, streamed I/O, failed only after retries.
> - ✅ The AWS SDK's default checksums stored `aws-chunked` framing inside uploaded objects on S3-compatible stores, corrupting video files.
>
> **Still open / needs a decision:**
>
> - **Production provider endpoints.** EcoCash merchant API paths are placeholders until the real spec is available. Paystack follows its public API but is untested against a live account. BunnyCDN token signing follows Bunny's documented scheme but is untested against a real pull zone.
> - **ZIPIT** has no public merchant API, so it needs a bank or aggregator partner.
> - **Card subscriptions don't auto-renew.** Renewing Paystack-paid subscriptions needs stored card authorizations (`charge_authorization`).
> - **Not built yet:** notifications (payment_completed etc.), trending/view counts, offline downloads (mobile, M11).
> - **Validation location:** request bodies are still parsed with Zod inside services rather than a shared pipe. The behaviour is consistent; this is a style refactor.

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
