# M2 — Auth

**Goal (CLAUDE.md §14):** users sign in with phone + OTP and stay signed in.

## Milestone acceptance

- Dev flow: enter phone → receive code in logs → submit → land on `/me` with name editable.
- Refresh token rotates on use.
- Expired access token returns 401 with the right error code.

## Tickets

### SZW-M02-001 — WhatsApp Business OTP client (dev-mode stub)

**Goal:** A `WhatsAppClient` with a dev stub that logs the OTP code.
**Scope:**

- `apps/api/src/modules/notifications/whatsapp.client.ts` with `send(template, to, vars)`.
- In `NODE_ENV=development`, log `{ to, code }` via pino info and return success.
- In production, real WhatsApp Business API call using `WHATSAPP_PHONE_ID` / `WHATSAPP_TOKEN`. Wire as a class but feature-gate behind env — prod keys not required for M2.
  **Acceptance:**
- Dev call produces a log line containing the OTP code.
- Production path compiles but is unreachable in dev.
  **Invariants:** §13.
  **Depends on:** SZW-M01-010.

### SZW-M02-002 — SMS fallback client (Bulkgate adapter)

**Goal:** Equivalent SMS client used when WhatsApp delivery fails.
**Scope:**

- `apps/api/src/modules/notifications/sms.client.ts` — Bulkgate HTTP adapter.
- Dev: same log-only behavior as WhatsApp.
- Returns success/failure; caller decides fallback.
  **Acceptance:**
- Dev call produces an SMS-tagged log line.
  **Invariants:** §13.
  **Depends on:** SZW-M01-010.

### SZW-M02-003 — OTP service

**Goal:** Service that generates, hashes, persists, sends, and verifies OTP codes.
**Scope:**

- `OtpService.request(phone)`: generates 6-digit code, bcrypt-hashes, inserts `otp_challenges` row with 5-min `expires_at`, sends via WhatsApp; on failure falls back to SMS; records `channel`.
- `OtpService.verify(phone, code)`: looks up most recent unconsumed challenge, increments `attempts` (max 5 then locks), bcrypt-compares, marks `consumed_at` on success.
- Typed errors: `OtpExpiredError`, `OtpInvalidError`, `OtpLockedError` (extend `DomainError`).
  **Acceptance:**
- Happy path: consumed row exists.
- 6 wrong attempts → locked; correct code after → still locked.
- Expired code → expired error.
  **Invariants:** §3.13.
  **Depends on:** SZW-M01-009, SZW-M02-001, SZW-M02-002.

### SZW-M02-004 — POST /auth/otp/request

**Goal:** Endpoint to trigger OTP send.
**Scope:**

- Body: `{ phone }` validated with Zod E.164 schema in `@streamzw/shared`.
- Calls `OtpService.request`.
- Rate limit: 1 request per phone per 60s, 5 per phone per hour (Redis).
- 202 with `{ status: 'sent' }`.
  **Acceptance:**
- Invalid phone → 400 with structured error.
- Two rapid requests for same phone → second is 429.
  **Invariants:** §3.13.
  **Depends on:** SZW-M02-003.

### SZW-M02-005 — POST /auth/otp/verify

**Goal:** Verify code, create user if new, return tokens.
**Scope:**

- Body: `{ phone, code }`.
- Calls `OtpService.verify`.
- On success: upsert `users` row keyed by `phone_e164`; set `kyc_state = 'phone_verified'` on first verify.
- Issues access (15-min) + refresh (30-day) tokens via `JwtService`.
- Stores refresh token hash in `refresh_tokens`.
  **Acceptance:**
- New phone → new user row, returns tokens.
- Existing phone → same user id, returns tokens.
- Invalid code → 401 with `OTP_INVALID` error code.
  **Invariants:** §3.13, §3.14, §3.15.
  **Depends on:** SZW-M02-003.

### SZW-M02-006 — JwtService + JwtGuard

**Goal:** Token issuance, validation, and guard for protected routes.
**Scope:**

- `JwtService`: `signAccess(userId, role)`, `signRefresh(userId)`, `verifyAccess`, `verifyRefresh`.
- Separate secrets per §11.
- `JwtGuard` extracts Bearer token, verifies, attaches user to request.
- `RolesGuard` decorator-driven (`@Roles('creator')`).
- Error codes: `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `AUTH_FORBIDDEN`.
  **Acceptance:**
- Expired access token → 401 `AUTH_TOKEN_EXPIRED`.
- Tampered token → 401 `AUTH_TOKEN_INVALID`.
- Valid token + wrong role → 403.
  **Invariants:** §3.14.
  **Depends on:** SZW-M01-009.

### SZW-M02-007 — POST /auth/refresh with rotation

**Goal:** Exchange a refresh token for a new pair, rotating the old one.
**Scope:**

- Body: `{ refresh_token }`.
- Validate signature → look up hash → ensure not revoked, not expired, not already rotated.
- Issue new pair; set `rotated_to` on old row to new row's id; set `revoked_at` on old.
- Reusing an already-rotated token revokes the entire chain (token reuse = suspicious).
  **Acceptance:**
- Single rotation succeeds, returns new pair.
- Reusing the original after rotation: 401 `AUTH_TOKEN_REUSED`; all tokens in chain revoked.
  **Invariants:** §3.14.
  **Depends on:** SZW-M02-006.

### SZW-M02-008 — POST /auth/logout

**Goal:** Revoke current refresh token.
**Scope:**

- Body: `{ refresh_token }` (or read from cookie if web uses cookies).
- Sets `revoked_at`. Idempotent.
  **Acceptance:**
- After logout, the refresh token cannot be used for `/auth/refresh`.
  **Invariants:** §3.14.
  **Depends on:** SZW-M02-007.

### SZW-M02-009 — GET/PATCH /users/me

**Goal:** Profile endpoints for the authenticated user.
**Scope:**

- `GET /users/me`: returns the row (no PII beyond what's in `users`).
- `PATCH /users/me`: accepts `display_name`, `preferred_display_currency`, `preferred_payout_currency`, `payout_msisdn`. Zod-validated.
- Currency fields against `CurrencyCode` union.
- `payout_msisdn` must be E.164.
  **Acceptance:**
- Unauthenticated → 401.
- Patching `display_name` persists.
- Patching `preferred_display_currency: 'XYZ'` → 400.
  **Invariants:** §3.13, §3.15.
  **Depends on:** SZW-M02-006.

### SZW-M02-010 — Web sign-in flow

**Goal:** Two-step UI for phone entry → OTP entry, lands on `/me`.
**Scope:**

- `app/(auth)/sign-in/page.tsx` — phone input, calls `POST /auth/otp/request`.
- `app/(auth)/verify/page.tsx` — 6-digit code input, calls `POST /auth/otp/verify`.
- On success: store access + refresh tokens (httpOnly cookies preferred).
- `app/me/page.tsx` — protected page rendering current user.
- Sign-out button calls `/auth/logout` and clears cookies.
  **Acceptance:**
- Manual test on local dev: works end-to-end with OTP from logs.
- Mobile-responsive (most viewers are on phones).
  **Invariants:** §3.13.
  **Depends on:** SZW-M02-005, SZW-M02-007, SZW-M02-008, SZW-M02-009.

### SZW-M02-011 — Web auth context + API client

**Goal:** Reusable auth state + fetch wrapper that handles refresh-on-401.
**Scope:**

- `apps/web/src/lib/auth.ts` — context provider exposing `user`, `signOut`, `isAuthenticated`.
- `apps/web/src/lib/api.ts` — typed fetch wrapper that:
  - Auto-attaches access token.
  - On 401 `AUTH_TOKEN_EXPIRED`: calls `/auth/refresh`, retries once.
  - On 401 `AUTH_TOKEN_REUSED`: forces sign-out.
- Types pulled from `@streamzw/shared`.
  **Acceptance:**
- Expired access token mid-session is transparent to the UI.
- Token reuse path logs the user out and redirects to sign-in.
  **Invariants:** §3.14.
  **Depends on:** SZW-M02-010.
