# M3 — Video lifecycle

**Goal (CLAUDE.md §14):** a creator can upload a video and it becomes a playable HLS stream.

## Milestone acceptance

- Upload a 30-second mp4 from the creator studio → 2 minutes later, state is `ready` → publish → catalog shows it → it plays in hls.js.

## Tickets

### SZW-M03-001 — Migration 0002: videos + renditions

**Goal:** Schema for video metadata and rendition tracking.
**Scope:**

- `infra/migrations/0002_videos.sql`:
  - `access_mode` and `video_state` enums.
  - `videos` table per §9, including `in_premium_pool` generated column and `search_doc` GIN index.
  - `renditions` table per §9.
  - Check constraint `ppv_price_required`.
- Drizzle schemas in `apps/api/src/db/schema/videos.ts` and `renditions.ts`.
  **Acceptance:**
- Migrate; re-run no-op.
- Inserting `access_mode = 'ppv'` row without `ppv_price_minor_units` fails the check.
  **Invariants:** §3.1, §3.5.
  **Depends on:** SZW-M01-009.

### SZW-M03-002 — POST /videos (create + presigned upload)

**Goal:** Creator initiates an upload; gets MinIO presigned multipart URLs.
**Scope:**

- Body: `{ title, access_mode, ppv_price?: { amount_minor, currency } }`.
- Auth: `role = 'creator'` (else 403).
- Creates `videos` row in `uploading` state.
- Initiates multipart upload on `streamzw-videos` bucket; returns presigned PUT URLs for chunks + upload id.
- Original key: `videos/{video_id}/original.mp4`.
  **Acceptance:**
- Returns `{ video_id, upload_id, presigned_urls: [...] }`.
- Non-creator → 403.
- Invalid currency → 400.
  **Invariants:** §3.1, §3.5.
  **Depends on:** SZW-M03-001.

### SZW-M03-003 — POST /videos/:id/complete-upload

**Goal:** Finalize multipart upload and enqueue transcode.
**Scope:**

- Body: `{ parts: [{ part_number, etag }] }`.
- Calls MinIO `completeMultipartUpload`.
- Transitions video `uploading → processing`.
- Enqueues `transcode` BullMQ job with `{ video_id }`.
  **Acceptance:**
- Success: state moves to `processing`, job enqueued.
- Calling on a non-`uploading` video → 409 (state machine error).
  **Invariants:** none.
  **Depends on:** SZW-M03-002.

### SZW-M03-004 — Video state machine helper

**Goal:** Centralize valid state transitions.
**Scope:**

- `apps/api/src/modules/videos/state.ts` with transition table:
  - `uploading → processing | failed`
  - `processing → ready | failed`
  - `ready → published`
  - `published → unpublished`
  - `unpublished → published`
- `assertTransition(from, to)` throws `InvalidStateTransitionError`.
  **Acceptance:**
- Unit tests cover every valid + invalid transition.
  **Invariants:** none.
  **Depends on:** SZW-M03-001.

### SZW-M03-005 — BullMQ transcode worker (FFmpeg HLS)

**Goal:** Worker consumes `transcode` queue, produces 240p/480p/720p HLS, writes to MinIO.
**Scope:**

- `apps/api/src/workers/transcode.worker.ts` (start in api; document if/when to split into `apps/transcoder/`).
- For each rendition (240, 480, 720):
  - FFmpeg with `hls_time=6 hls_playlist_type=vod`.
  - Output: `videos/{id}/{height}p/index.m3u8` + segments.
  - Insert `renditions` row with `ready = true`.
- Write `videos/{id}/master.m3u8` referencing all renditions.
- On success: state → `ready`, set `duration_seconds`, `hls_playlist_key`.
- On failure: state → `failed`, structured error log, retry up to 3× with exponential backoff.
  **Acceptance:**
- 30-sec mp4 → 3 ready renditions in <2 min on typical dev box.
- All segments present in MinIO.
- `master.m3u8` references all three.
- Corrupt input → `failed` state, not stuck in `processing`.
  **Invariants:** §13.
  **Depends on:** SZW-M03-003, SZW-M03-004.

### SZW-M03-006 — MinIO key/layout helper

**Goal:** Single source for all MinIO key construction.
**Scope:**

- `packages/shared/src/storage-keys.ts`:
  - `originalKey(videoId)` → `videos/{id}/original.mp4`
  - `renditionPlaylistKey(videoId, height)` → `videos/{id}/{height}p/index.m3u8`
  - `renditionSegmentKey(videoId, height, idx)`
  - `masterPlaylistKey(videoId)` → `videos/{id}/master.m3u8`
  - `thumbnailKey(videoId)` → `thumbs/{id}.jpg`
    **Acceptance:**
- All MinIO calls in the codebase route through these helpers.
  **Invariants:** none.
  **Depends on:** SZW-M01-005.

### SZW-M03-007 — PATCH /videos/:id

**Goal:** Update mutable fields on a video.
**Scope:**

- Auth: owner only.
- Editable: `title`, `description`, `access_mode`, `ppv_price_minor_units`, `ppv_price_currency`.
- Validate `ppv_price_required` in the app layer too for clear error messages.
- Mode change does NOT alter existing `purchases` rows.
- `ppv_price_currency` must match user's `canonical_pricing_currency`; if null, lock it now.
  **Acceptance:**
- `free → ppv` without price → 400.
- `free → ppv` with valid price → 200.
- Non-owner → 403.
  **Invariants:** §3.1, §3.5.
  **Depends on:** SZW-M03-001.

### SZW-M03-008 — POST /videos/:id/publish

**Goal:** Move a `ready` video to `published`.
**Scope:**

- Auth: owner.
- Asserts state = `ready`; sets state = `published`, `published_at = now()`.
- Locks `users.canonical_pricing_currency` on first publish.
  **Acceptance:**
- Publishing a `processing` video → 409.
- Publishing a `ready` video succeeds.
- First publish writes `canonical_pricing_currency`.
  **Invariants:** §3.5.
  **Depends on:** SZW-M03-004, SZW-M03-005.

### SZW-M03-009 — Web upload page (creator studio)

**Goal:** UI for uploading a video, monitoring progress, publishing.
**Scope:**

- `app/studio/upload/page.tsx`:
  - File picker → chunked upload using presigned URLs (`@aws-sdk/client-s3` or hand-rolled fetch).
  - Progress bar per chunk.
  - On complete: call `/complete-upload`, poll `/videos/:id` for state changes.
  - Form: title, description, access_mode, ppv_price.
  - Publish button (enabled only when state = `ready`).
- Mobile-responsive.
  **Acceptance:**
- Local dev: pick mp4 → see progress → state `processing` → `ready` → publish.
- Network failure mid-upload allows resume (chunked upload preserves completed parts).
  **Invariants:** §3.2.
  **Depends on:** SZW-M03-002, SZW-M03-003, SZW-M03-007, SZW-M03-008.
