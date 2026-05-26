# M4 — Catalog + playback

**Goal (CLAUDE.md §14):** the public can browse and watch free videos.

## Milestone acceptance

- A logged-out viewer can browse, search, and play any `free` video.
- Viewing a `ppv`/`premium` video shows a placeholder paywall (real one in M5).

## Tickets

### SZW-M04-001 — Migration 0003: watch_sessions + watch_minutes_daily

**Goal:** Heartbeat infrastructure tables (used here, aggregated in M10).
**Scope:**

- `infra/migrations/0003_watch.sql`:
  - `watch_sessions` per §9 (nullable `user_id` for anonymous).
  - `watch_minutes_daily` per §9.
  - Indexes per §9.
- Drizzle schemas.
  **Acceptance:**
- Migrate; idempotent re-run.
  **Invariants:** §3.10.
  **Depends on:** SZW-M03-001.

### SZW-M04-002 — GET /videos (list with filters)

**Goal:** Public catalog endpoint.
**Scope:**

- Query params: `?mode=free|ppv|premium|premium_buyable`, `?creator=<handle>`, `?q=<search>`, `?cursor=`, `?limit=` (default 20, max 50).
- Only `state = 'published'` rows.
- Cursor pagination by `(published_at desc, id desc)`.
- Response: `{ items, next_cursor }`.
  **Acceptance:**
- Returns paginated list; cursor round-trips.
- Items include `published_at`, `title`, `thumbnail_url`, `access_mode`, creator info.
- Prices in viewer's preferred display currency (anonymous → USD).
  **Invariants:** §3.5.
  **Depends on:** SZW-M03-001.

### SZW-M04-003 — GET /videos/:id (metadata + access check)

**Goal:** Single-video endpoint that surfaces the access decision.
**Scope:**

- Returns metadata + `access_check_result` (placeholder until M5's real `checkAccess`).
- For M4: `free` → `{ ok: true }`; else → `{ ok: false, paywall: { placeholder: true } }`.
- Anonymous callers permitted.
  **Acceptance:**
- Free video → metadata + `{ ok: true }`.
- Non-free video → metadata + placeholder paywall.
  **Invariants:** §3.9 (placeholder code replaced in M5).
  **Depends on:** SZW-M04-002.

### SZW-M04-004 — Thumbnail extraction job

**Goal:** Auto-generate thumbnail from first frame.
**Scope:**

- BullMQ job `thumbnail.extract` queued by the transcoder on success.
- FFmpeg `-ss 00:00:01 -frames:v 1` → JPG → upload to `thumbs/{id}.jpg`.
- Update `videos.thumbnail_key`.
  **Acceptance:**
- After transcode, a thumbnail exists for the video.
- Re-running is idempotent (overwrites existing).
  **Invariants:** none.
  **Depends on:** SZW-M03-005.

### SZW-M04-005 — GET /videos/:id/playlist (BunnyCDN signed URL)

**Goal:** Returns a 5-minute-TTL signed CDN URL.
**Scope:**

- Reads `videos.hls_playlist_key`.
- Constructs BunnyCDN signed URL using `BUNNYCDN_SIGNING_KEY` (token auth with expiry).
- Gates on basic access check stub for M4: free → allowed; non-free → 402 with placeholder paywall.
  **Acceptance:**
- Free video: returns signed URL; playable within 5 min.
- Non-free video (anonymous): 402.
- TTL expiry → URL stops working at the CDN.
  **Invariants:** §3.9 (placeholder, replaced in M5).
  **Depends on:** SZW-M04-003.

### SZW-M04-006 — Postgres FTS search endpoint

**Goal:** `GET /search?q=` over `search_doc`.
**Scope:**

- `WHERE search_doc @@ websearch_to_tsquery('english', $q) AND state = 'published'`.
- Rank by `ts_rank_cd`.
- Same filter set as `GET /videos`.
- Cursor pagination.
  **Acceptance:**
- Search hits both title (weight A) and description (weight B); title matches rank higher.
- Empty query → 400.
  **Invariants:** §3.5.
  **Depends on:** SZW-M04-002.

### SZW-M04-007 — POST /watch/sessions (start)

**Goal:** Start a watch session for a video.
**Scope:**

- Body: `{ video_id }`.
- Inserts `watch_sessions` row with `user_id` (or null for anonymous).
- Returns `{ session_id }`.
  **Acceptance:**
- Authenticated: row has user_id.
- Anonymous: row has null user_id.
  **Invariants:** §3.10.
  **Depends on:** SZW-M04-001.

### SZW-M04-008 — POST /watch/sessions/:id/heartbeat

**Goal:** 15-second heartbeat that accumulates watched minutes.
**Scope:**

- Server-side compute: if `(now - last_heartbeat) ∈ [10s, 25s]`, increment `minutes_watched` by 0.25 (or store as `seconds_watched` bigint — pick one and document; recommend storing seconds, deriving minutes at read time).
- Set `last_heartbeat = now`.
- Gap > 25s: don't increment; just bump `last_heartbeat` (viewer paused / closed tab).
- Caller spamming heartbeats → only genuine 15s windows count.
  **Acceptance:**
- 4 heartbeats spaced ~15s apart → watched count up by ~1 minute.
- Spamming 100/min → only legitimate windows counted.
- Per §3.10: derived ONLY from heartbeats, not start/stop.
  **Invariants:** §3.10.
  **Depends on:** SZW-M04-007.

### SZW-M04-009 — POST /watch/sessions/:id/end

**Goal:** Mark session ended (informational; not used for minute calc).
**Scope:**

- Sets `ended = true`.
- Does NOT compute minutes from start/end times.
  **Acceptance:**
- Row's `ended` flag flips.
  **Invariants:** §3.10.
  **Depends on:** SZW-M04-007.

### SZW-M04-010 — Web catalog/browse page

**Goal:** Home page with paginated grid of videos.
**Scope:**

- `app/page.tsx` (replaces M1 placeholder).
- Server-rendered first page from `GET /videos`.
- Filter bar: free / ppv / premium / all.
- Click → video page.
- Mobile-first layout: 2-col grid on phone, 4-col on desktop.
  **Acceptance:**
- Lighthouse mobile score > 80.
- Pagination works.
  **Invariants:** §3.5.
  **Depends on:** SZW-M04-002.

### SZW-M04-011 — Web video page + hls.js player

**Goal:** Video detail + player.
**Scope:**

- `app/v/[id]/page.tsx`.
- Fetches `GET /videos/:id`.
- If `access_check_result.ok`: fetch playlist URL, instantiate hls.js, render `<video>` with adaptive rendition switching.
- POSTs `/watch/sessions` on play, `/heartbeat` every 15s, `/end` on unload.
- If not ok: placeholder paywall (real UI in M5).
  **Acceptance:**
- Free video plays on desktop and mobile browsers.
- Heartbeats fire while playing, pause when paused.
- Non-free video shows placeholder.
  **Invariants:** §3.9, §3.10.
  **Depends on:** SZW-M04-005, SZW-M04-007, SZW-M04-008, SZW-M04-009.

### SZW-M04-012 — Web search page

**Goal:** Search results UI.
**Scope:**

- `app/search/page.tsx` accepting `?q=`.
- Shares the video-card component with the catalog page.
- Empty state for no results.
  **Acceptance:**
- Searching "test" returns matching videos.
- URL-driven (shareable).
  **Invariants:** §3.5.
  **Depends on:** SZW-M04-006, SZW-M04-010.
