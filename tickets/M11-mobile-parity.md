# M11 — Mobile parity

**Goal (CLAUDE.md §14):** Flutter app reaches feature parity with web for viewers.

## Milestone acceptance

- An Android user can sign in, subscribe via EcoCash, download a video for offline viewing while on Wi-Fi, then watch it on a 3-day road trip with no data.

## Tickets

### SZW-M11-001 — Flutter app scaffold

**Goal:** `apps/mobile/` running on Android.
**Scope:**

- `flutter create apps/mobile` (Android-first; iOS deferred per §17).
- Config: Riverpod (or Bloc) for state, GoRouter for routing, Dio for HTTP.
- Env via `flutter_dotenv` pointing at the same API base.
- Dark-mode-first design system matching web.
  **Acceptance:**
- `flutter run` on Android device shows a placeholder home screen.
  **Invariants:** none.
  **Depends on:** SZW-M01-001.

### SZW-M11-002 — Mobile auth (OTP + JWT)

**Goal:** Phone → OTP → signed in.
**Scope:**

- Sign-in screen (phone) + verify screen (6-digit code).
- Calls `/auth/otp/request` + `/auth/otp/verify`.
- Tokens stored via `flutter_secure_storage` (Android Keystore-backed).
- Auto-refresh on 401 with rotation; sign-out on `AUTH_TOKEN_REUSED`.
  **Acceptance:**
- Sign-in works on Android.
- Token in Keystore, not plain shared prefs.
  **Invariants:** §3.13, §3.14.
  **Depends on:** SZW-M11-001, SZW-M02-005.

### SZW-M11-003 — Mobile catalog/browse

**Goal:** Paginated home grid.
**Scope:**

- Grid view fed by `GET /videos`.
- Pull-to-refresh.
- Filter chips (free/ppv/premium).
- Thumbnails cached via `cached_network_image`.
  **Acceptance:**
- Smooth scroll on a mid-range Android (RAM ≤ 3GB).
  **Invariants:** §3.5.
  **Depends on:** SZW-M11-002, SZW-M04-002.

### SZW-M11-004 — Mobile search

**Goal:** Search screen + results.
**Scope:**

- Top search bar; debounced 300ms.
- Calls `/search?q=`.
  **Acceptance:**
- Works as on web.
  **Invariants:** §3.5.
  **Depends on:** SZW-M11-003.

### SZW-M11-005 — Mobile video page (better_player)

**Goal:** Adaptive HLS playback on mobile.
**Scope:**

- `better_player` for HLS (handles MediaCodec quirks better than raw `video_player`).
- Fetch signed playlist URL from `/videos/:id/playlist`.
- Send `POST /watch/sessions` on play; 15s heartbeats; `/end` on dispose.
- Full-screen toggle.
  **Acceptance:**
- Free video plays on Android with adaptive bitrate switching.
  **Invariants:** §3.10.
  **Depends on:** SZW-M11-003, SZW-M04-005.

### SZW-M11-006 — Mobile paywall flows

**Goal:** Three paywall variants matching web.
**Scope:**

- Renders `PaywallPayload` from `/videos/:id`.
- Buy button → EcoCash deep link (SZW-M11-007) or in-app card.
- Subscribe button → checkout (SZW-M11-008).
  **Acceptance:**
- All three layouts render correctly.
- Buttons trigger the right next screen.
  **Invariants:** §3.9.
  **Depends on:** SZW-M11-005, SZW-M05-007.

### SZW-M11-007 — EcoCash deep-link payment

**Goal:** Hand off to EcoCash app, return on completion.
**Scope:**

- `POST /payments` → returns provider deep link.
- `url_launcher` opens EcoCash; deep-link return URL brings user back.
- Poll `/videos/:id` for unlock.
  **Acceptance:**
- Sandbox: pay $0.50 → unlock → play.
  **Invariants:** §3.11.
  **Depends on:** SZW-M11-006, SZW-M06-005.

### SZW-M11-008 — In-app card payment (Paystack)

**Goal:** Card flow for diaspora.
**Scope:**

- Paystack Flutter SDK (or WebView fallback).
- `POST /payments` with `provider = 'paystack'`.
- Webhook closes the loop (existing api handler).
  **Acceptance:**
- Sandbox card → unlock.
  **Invariants:** §3.11.
  **Depends on:** SZW-M11-006.

### SZW-M11-009 — Offline downloads with encryption

**Goal:** Download HLS for offline playback; encrypted at rest.
**Scope:**

- Wi-Fi only by default (toggle in settings to allow mobile data).
- Download all rendition segments via `flutter_downloader`.
- Store under app-private storage with AES encryption (per-video key wrapped by user-specific master key in Keystore).
- Track downloads in a local sqlite DB.
- Re-validate access on play (offline grace: 30 days from last successful online access check).
- Delete on access loss (e.g. sub expires beyond grace).
  **Acceptance:**
- Download a video on Wi-Fi → fly mode → play.
- Force-delete on sub expiry beyond grace.
- Files unreadable outside the app (sanity check).
  **Invariants:** §3.9, §3.15.
  **Depends on:** SZW-M11-005.

### SZW-M11-010 — Push notifications (FCM)

**Goal:** Push for payment receipts, sub renewals, new videos from followed creators.
**Scope:**

- FCM setup; token registration on sign-in.
- `POST /devices` to register push token against user.
- Notifications module fans out: WhatsApp → SMS → push (mobile-only fallback).
  **Acceptance:**
- Test notification arrives on Android.
- Renewal reminder triggers push if WhatsApp unavailable.
  **Invariants:** §3.13.
  **Depends on:** SZW-M11-002, SZW-M08-008.
