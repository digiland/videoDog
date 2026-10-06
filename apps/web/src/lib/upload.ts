/**
 * Resumable multipart upload — the pure parts (planning, retry schedule, resume matching,
 * a small concurrency pool) plus one browser helper that PUTs a part with progress.
 *
 * Creators upload over mobile data that drops out. The file is cut into the server's part
 * size (8 MiB); 2–3 parts go up at once; a failed part retries with backoff before the
 * upload pauses. After a refresh the creator re-picks the same file and only the missing
 * parts are sent.
 */

export const UPLOAD_CONCURRENCY = 3;
export const PART_ATTEMPTS = 3;
/** Multipart uploads left this long are treated as gone (storage may have aborted them). */
export const RESUME_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const RESUME_STORAGE_KEY = 'streamzw:studio-upload';

export type PartPlan = { part_number: number; start: number; end: number; size: number };

/** Byte ranges for each part (1-based numbers, end exclusive). Matches the server's count. */
export function planParts(sizeBytes: number, partSize: number): PartPlan[] {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new RangeError('empty file');
  if (!Number.isSafeInteger(partSize) || partSize <= 0) throw new RangeError('bad part size');
  const count = Math.ceil(sizeBytes / partSize);
  return Array.from({ length: count }, (_, i) => {
    const start = i * partSize;
    const end = Math.min(start + partSize, sizeBytes);
    return { part_number: i + 1, start, end, size: end - start };
  });
}

/**
 * Wait before retry number `retry` (1 = first retry): 1s, 3s, 9s … capped. `jitter` (0–1)
 * spreads retries so parallel parts don't hammer a recovering network in lockstep.
 */
export function backoffDelay(
  retry: number,
  { baseMs = 1000, factor = 3, maxMs = 30_000, jitter = 0, random = Math.random } = {},
): number {
  const raw = Math.min(maxMs, baseMs * factor ** Math.max(0, retry - 1));
  if (jitter <= 0) return raw;
  const spread = raw * Math.min(1, jitter);
  return Math.round(raw - spread + random() * 2 * spread);
}

/** Delays between attempts: `attempts` tries means `attempts - 1` waits. */
export function retrySchedule(attempts = PART_ATTEMPTS): number[] {
  return Array.from({ length: Math.max(0, attempts - 1) }, (_, i) => backoffDelay(i + 1));
}

/** Bytes sent so far: finished parts count fully; in-flight parts count what's loaded. */
export function bytesUploaded(
  plan: readonly PartPlan[],
  done: ReadonlySet<number>,
  loaded: ReadonlyMap<number, number>,
): number {
  let total = 0;
  for (const p of plan) {
    if (done.has(p.part_number)) total += p.size;
    else total += Math.min(p.size, Math.max(0, loaded.get(p.part_number) ?? 0));
  }
  return total;
}

/** Whole percent, never 100 until every byte is in (so "100%" means done). */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.floor((done / total) * 100));
}

/** "245.3 MB" — the unit data bundles are sold in (decimal megabytes). */
export function formatMB(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString('en-US')} MB`;
}

export type Sample = { at: number; bytes: number };

/**
 * Seconds left from recent progress samples (oldest first): speed over the window, not
 * since start, so a connection that just improved shows it. Null until there's a signal.
 */
export function etaSeconds(samples: readonly Sample[], total: number): number | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.at - first.at < 2000) return null;
  const rate = (last.bytes - first.bytes) / ((last.at - first.at) / 1000);
  if (rate <= 0) return null;
  return Math.max(1, Math.ceil((total - last.bytes) / rate));
}

/** "≈ 4 min left" / "≈ 30 s left" — rounded so it doesn't flicker. */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `≈ ${Math.max(5, Math.ceil(seconds / 5) * 5)} s left`;
  const min = Math.ceil(seconds / 60);
  if (min < 90) return `≈ ${min} min left`;
  return `≈ ${Math.round(min / 60)} h left`;
}

// --- Resume state ------------------------------------------------------------------------

export type FileIdentity = { name: string; size: number; lastModified: number };

export type UploadDraft = {
  title: string;
  description: string;
  access_mode: 'free' | 'ppv' | 'premium' | 'premium_buyable';
  price: string;
};

export type ResumeRecord = {
  v: 1;
  video_id: string;
  upload_id: string;
  part_count: number;
  part_size: number;
  file: FileIdentity;
  saved_at: number;
  draft?: UploadDraft;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Parse what we stored; anything malformed or stale is treated as nothing to resume. */
export function parseResumeRecord(raw: string | null, now = Date.now()): ResumeRecord | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1 || !isObj(v.file)) return null;
  const f = v.file;
  const ok =
    typeof v.video_id === 'string' &&
    typeof v.upload_id === 'string' &&
    Number.isSafeInteger(v.part_count) &&
    (v.part_count as number) > 0 &&
    Number.isSafeInteger(v.part_size) &&
    (v.part_size as number) > 0 &&
    typeof v.saved_at === 'number' &&
    typeof f.name === 'string' &&
    Number.isSafeInteger(f.size) &&
    typeof f.lastModified === 'number';
  if (!ok) return null;
  const rec = v as unknown as ResumeRecord;
  if (now - rec.saved_at > RESUME_MAX_AGE_MS) return null;
  if (Math.ceil(rec.file.size / rec.part_size) !== rec.part_count) return null;
  return rec;
}

export type ResumeMatch = { ok: true } | { ok: false; reason: 'name' | 'size' | 'modified' };

/** The re-picked file must be the very same file: same name, size and modified time. */
export function matchResume(rec: ResumeRecord, file: FileIdentity): ResumeMatch {
  if (file.size !== rec.file.size) return { ok: false, reason: 'size' };
  if (file.name !== rec.file.name) return { ok: false, reason: 'name' };
  if (file.lastModified !== rec.file.lastModified) return { ok: false, reason: 'modified' };
  return { ok: true };
}

/** A starting title from the file name: "my_show-ep1.mp4" → "my show ep1". */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return base.trim().slice(0, 120) || 'Untitled video';
}

// --- Errors ------------------------------------------------------------------------------

/** HTTP failure of a part PUT. status 0 = network error (no response). */
export class PartHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly part: number,
  ) {
    super(status === 0 ? `Part ${part}: network error` : `Part ${part}: HTTP ${status}`);
    this.name = 'PartHttpError';
  }
  /** 403: the signed URL expired or was rejected — needs fresh URLs, not a blind retry. */
  get needsFreshUrl(): boolean {
    return this.status === 403;
  }
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

/** Network errors, timeouts, throttling and server errors are worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof PartHttpError)) return false;
  const s = err.status;
  return s === 0 || s === 408 || s === 429 || s >= 500;
}

// --- Async helpers -----------------------------------------------------------------------

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new AbortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type RetryOptions = {
  attempts?: number;
  delays?: readonly number[];
  signal?: AbortSignal;
  shouldRetry?: (err: unknown) => boolean;
  /** Called before waiting for retry `attempt` (2 = second try). */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Run `fn` up to `attempts` times, waiting the scheduled delay between tries. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    attempts = PART_ATTEMPTS,
    delays = retrySchedule(attempts),
    signal,
    shouldRetry = isRetryable,
    onRetry,
    wait = sleep,
  }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new AbortError();
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw new AbortError();
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      const delay = delays[attempt - 1] ?? delays[delays.length - 1] ?? 0;
      onRetry?.(attempt + 1, delay, err);
      await wait(delay, signal);
    }
  }
}

/**
 * Run `worker` over `items`, at most `limit` at once. The first failure stops new work,
 * aborts the others (via the signal each worker gets) and is what the pool rejects with.
 * Aborting `signal` stops everything with an AbortError.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const inner = new AbortController();
  const forward = () => inner.abort();
  if (signal?.aborted) throw new AbortError();
  signal?.addEventListener('abort', forward, { once: true });
  let next = 0;
  let failure: { err: unknown } | null = null;

  async function lane() {
    while (!inner.signal.aborted && next < items.length) {
      const item = items[next++] as T;
      try {
        await worker(item, inner.signal);
      } catch (err) {
        if (!failure && !inner.signal.aborted) failure = { err };
        inner.abort();
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  } finally {
    signal?.removeEventListener('abort', forward);
  }
  if (failure) throw (failure as { err: unknown }).err;
  if (signal?.aborted) throw new AbortError();
}

// --- Browser: PUT one part ---------------------------------------------------------------

/**
 * PUT a part's bytes to its presigned URL (no auth header) with upload progress.
 * Rejects with PartHttpError (status 0 for network failure) or AbortError.
 */
export function putPart(
  url: string,
  body: Blob,
  part: number,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const done = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      done(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new PartHttpError(xhr.status, part)),
      );
    xhr.onerror = () => done(() => reject(new PartHttpError(0, part)));
    xhr.ontimeout = () => done(() => reject(new PartHttpError(0, part)));
    xhr.onabort = () => done(() => reject(new AbortError()));
    xhr.send(body);
  });
}
