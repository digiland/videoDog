'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../src/lib/api';
import {
  AbortError,
  PartHttpError,
  RESUME_STORAGE_KEY,
  UPLOAD_CONCURRENCY,
  bytesUploaded,
  etaSeconds,
  isRetryable,
  matchResume,
  parseResumeRecord,
  planParts,
  putPart,
  runPool,
  withRetry,
  type PartPlan,
  type ResumeRecord,
  type Sample,
  type UploadDraft,
} from '../../../src/lib/upload';
import type { Video } from '../../../src/types/api';
import { errorMessage } from './studio-data';

export type Phase =
  | 'idle'
  | 'starting'
  | 'uploading'
  | 'paused'
  | 'finishing'
  | 'processing'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'failed';

export type PauseReason = 'offline' | 'error' | 'user';

export type UploadView = {
  phase: Phase;
  pauseReason: PauseReason | null;
  /** What happened, in plain words, when something went wrong. */
  message: string | null;
  videoId: string | null;
  fileName: string | null;
  totalBytes: number;
  sentBytes: number;
  partCount: number;
  partsDone: number;
  /** A part that failed and is about to be tried again. */
  retrying: { part: number; attempt: number; inSeconds: number } | null;
  etaSeconds: number | null;
};

const INITIAL: UploadView = {
  phase: 'idle',
  pauseReason: null,
  message: null,
  videoId: null,
  fileName: null,
  totalBytes: 0,
  sentBytes: 0,
  partCount: 0,
  partsDone: 0,
  retrying: null,
  etaSeconds: null,
};

type Job = {
  videoId: string;
  uploadId: string;
  file: File;
  plan: PartPlan[];
  urls: Map<number, string>;
  done: Set<number>;
  loaded: Map<number, number>;
  ctrl: AbortController | null;
  /** One automatic URL refresh per run when a signed URL is rejected (403). */
  refreshed: boolean;
  record: ResumeRecord;
};

type MultipartStart = {
  upload_id: string;
  part_size: number;
  part_count: number;
  parts: { part_number: number; url: string }[];
};
type MultipartStatus = {
  uploaded: { part_number: number; size: number }[];
  parts: { part_number: number; url: string }[];
};

export type CreateVideoBody = {
  title: string;
  description?: string;
  access_mode: Video['access_mode'];
  ppv_price_minor_units?: number;
  ppv_price_currency?: string;
};

// --- localStorage (may be blocked: private mode, cleared data) ----------------------------

export function readResumeRecord(): ResumeRecord | null {
  try {
    return parseResumeRecord(localStorage.getItem(RESUME_STORAGE_KEY));
  } catch {
    return null;
  }
}
function writeRecord(rec: ResumeRecord) {
  try {
    localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // storage blocked: resume works until the page is closed
  }
}
export function clearResumeRecord() {
  try {
    localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** In-flight bytes don't survive an abort; those parts start over. */
function dropInflight(j: Job) {
  for (const n of [...j.loaded.keys()]) if (!j.done.has(n)) j.loaded.delete(n);
}

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

const FAILED_PROCESSING =
  "We couldn't process this video. The file may be damaged or in an unusual format. Export it as MP4 and upload it again.";

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

/**
 * Multipart upload that survives dropped connections, pauses offline, resumes when the
 * network returns, and after a refresh resumes from the same file. Owns the whole life of
 * an upload: create → parts → complete → processing → ready → publish.
 */
export function useResumableUpload() {
  const [view, setView] = useState<UploadView>(INITIAL);
  const viewRef = useRef(view);
  viewRef.current = view;
  const job = useRef<Job | null>(null);
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const samples = useRef<Sample[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const patch = useCallback((p: Partial<UploadView>) => {
    if (alive.current) setView((v) => ({ ...v, ...p }));
  }, []);

  const flushProgress = useCallback(() => {
    const j = job.current;
    if (!j || !alive.current) return;
    const sent = bytesUploaded(j.plan, j.done, j.loaded);
    const now = Date.now();
    const s = samples.current;
    s.push({ at: now, bytes: sent });
    while (s.length > 2 && now - (s[0]?.at ?? now) > 15_000) s.shift();
    setView((v) => ({
      ...v,
      sentBytes: sent,
      partsDone: j.done.size,
      etaSeconds: etaSeconds(s, j.file.size),
    }));
  }, []);

  /** Progress events fire constantly; repaint at most 4×/s. */
  const emit = useCallback(() => {
    if (emitTimer.current) return;
    emitTimer.current = setTimeout(() => {
      emitTimer.current = null;
      flushProgress();
    }, 250);
  }, [flushProgress]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const watchProcessing = useCallback(
    (videoId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const v = await api.get<Video>(`/videos/${videoId}`);
          if (v.state === 'ready') return patch({ phase: 'ready' });
          if (v.state === 'published') return patch({ phase: 'published' });
          if (v.state === 'failed') return patch({ phase: 'failed', message: FAILED_PROCESSING });
        } catch {
          // a blip while polling: keep waiting
        }
        if (alive.current) pollTimer.current = setTimeout(() => void tick(), 4000);
      };
      pollTimer.current = setTimeout(() => void tick(), 3000);
    },
    [patch, stopPolling],
  );

  const pauseWith = useCallback(
    (reason: PauseReason, message: string | null = null) => {
      const j = job.current;
      if (j?.ctrl) {
        const c = j.ctrl;
        j.ctrl = null;
        c.abort();
      }
      if (j) dropInflight(j);
      samples.current = [];
      patch({ phase: 'paused', pauseReason: reason, message, retrying: null, etaSeconds: null });
      flushProgress();
    },
    [patch, flushProgress],
  );

  const finish = useCallback(
    async (j: Job) => {
      patch({ phase: 'finishing', retrying: null, etaSeconds: null });
      try {
        const res = await api.post<{ status: string }>(
          `/videos/${j.videoId}/upload/multipart/${encodeURIComponent(j.uploadId)}/complete`,
        );
        clearResumeRecord();
        if (res.status === 'ready') patch({ phase: 'ready' });
        else {
          patch({ phase: 'processing' });
          watchProcessing(j.videoId);
        }
      } catch (err) {
        if (!online()) pauseWith('offline');
        else
          pauseWith('error', `Couldn't finish the upload: ${errorMessage(err, 'unknown error')}.`);
      }
    },
    [patch, pauseWith, watchProcessing],
  );

  /** Ask the server which parts it has; get fresh URLs for the rest. */
  const refresh = useCallback(async (j: Job) => {
    const st = await api.get<MultipartStatus>(
      `/videos/${j.videoId}/upload/multipart/${encodeURIComponent(j.uploadId)}?part_count=${j.plan.length}`,
    );
    const sizes = new Map(j.plan.map((p) => [p.part_number, p.size]));
    j.done = new Set(
      st.uploaded.filter((u) => sizes.get(u.part_number) === u.size).map((u) => u.part_number),
    );
    j.urls = new Map(st.parts.map((p) => [p.part_number, p.url]));
    j.loaded = new Map();
  }, []);

  const sendPart = useCallback(
    async (j: Job, p: PartPlan, signal: AbortSignal) => {
      const n = p.part_number;
      const url = j.urls.get(n);
      if (!url) throw new PartHttpError(403, n);
      await withRetry(
        async () => {
          j.loaded.set(n, 0);
          await putPart(
            url,
            j.file.slice(p.start, p.end),
            n,
            (loaded) => {
              j.loaded.set(n, loaded);
              emit();
            },
            signal,
          );
        },
        {
          signal,
          shouldRetry: (e) => isRetryable(e) && online(),
          onRetry: (attempt, delay) => {
            j.loaded.set(n, 0);
            patch({ retrying: { part: n, attempt, inSeconds: Math.round(delay / 1000) } });
            emit();
          },
        },
      );
      j.done.add(n);
      j.loaded.delete(n);
      if (alive.current) {
        setView((v) => (v.retrying?.part === n ? { ...v, retrying: null } : v));
      }
      emit();
    },
    [emit, patch],
  );

  const run = useCallback(async () => {
    const j = job.current;
    if (!j) return;
    const ctrl = new AbortController();
    j.ctrl = ctrl;
    patch({ phase: 'uploading', pauseReason: null, message: null, retrying: null });
    flushProgress();
    const pending = j.plan.filter((p) => !j.done.has(p.part_number));
    try {
      await runPool(pending, UPLOAD_CONCURRENCY, (p, s) => sendPart(j, p, s), ctrl.signal);
    } catch (err) {
      if (j.ctrl !== ctrl) return; // paused or cancelled: that path already set the state
      j.ctrl = null;
      dropInflight(j);
      if (err instanceof AbortError) return;
      if (!online()) return pauseWith('offline');
      if (err instanceof PartHttpError && err.needsFreshUrl && !j.refreshed) {
        j.refreshed = true;
        try {
          await refresh(j);
          return void run();
        } catch {
          // fall through to a manual resume
        }
      }
      const part = err instanceof PartHttpError ? err.part : null;
      return pauseWith(
        'error',
        part
          ? `Part ${part} of ${j.plan.length} didn't go through after 3 tries. Check your signal and tap Resume — finished parts are kept.`
          : `Upload stopped: ${errorMessage(err, 'unknown error')}. Tap Resume to carry on.`,
      );
    }
    if (j.ctrl !== ctrl) return;
    j.ctrl = null;
    j.refreshed = false;
    await finish(j);
  }, [patch, flushProgress, sendPart, pauseWith, refresh, finish]);

  const resuming = useRef(false);
  const resume = useCallback(async () => {
    const j = job.current;
    if (!j || j.ctrl || resuming.current) return;
    resuming.current = true;
    patch({ phase: 'uploading', pauseReason: null, message: null });
    try {
      await refresh(j);
    } catch (err) {
      resuming.current = false;
      if (!online()) pauseWith('offline');
      else pauseWith('error', `Couldn't reach StreamZW: ${errorMessage(err, 'network error')}.`);
      return;
    }
    resuming.current = false;
    flushProgress();
    await run();
  }, [patch, refresh, run, flushProgress, pauseWith]);

  const start = useCallback(
    async (file: File, body: CreateVideoBody, draft: UploadDraft) => {
      stopPolling();
      samples.current = [];
      setView({ ...INITIAL, phase: 'starting', fileName: file.name, totalBytes: file.size });
      let videoId: string | null = null;
      try {
        const created = await api.post<{ video_id: string }>('/videos', body);
        videoId = created.video_id;
        const mp = await api.post<MultipartStart>(`/videos/${videoId}/upload/multipart`, {
          size_bytes: file.size,
          content_type: /^video\/[\w.+-]+$/.test(file.type) ? file.type : 'video/mp4',
        });
        const plan = planParts(file.size, mp.part_size);
        const record: ResumeRecord = {
          v: 1,
          video_id: videoId,
          upload_id: mp.upload_id,
          part_count: mp.part_count,
          part_size: mp.part_size,
          file: { name: file.name, size: file.size, lastModified: file.lastModified },
          saved_at: Date.now(),
          draft,
        };
        writeRecord(record);
        job.current = {
          videoId,
          uploadId: mp.upload_id,
          file,
          plan,
          urls: new Map(mp.parts.map((p) => [p.part_number, p.url])),
          done: new Set(),
          loaded: new Map(),
          ctrl: null,
          refreshed: false,
          record,
        };
        patch({ videoId, partCount: plan.length });
        await run();
      } catch (err) {
        patch({
          phase: 'failed',
          videoId,
          message: online()
            ? `Couldn't start the upload: ${errorMessage(err, 'unknown error')}.`
            : "You're offline. Connect and pick the file again.",
        });
      }
    },
    [patch, run, stopPolling],
  );

  /** After a refresh: the creator re-picked a file; continue if it's the same one. */
  const resumeFrom = useCallback(
    async (rec: ResumeRecord, file: File): Promise<string | null> => {
      const m = matchResume(rec, file);
      if (!m.ok) {
        return m.reason === 'size'
          ? `That's a different file (size doesn't match). Pick "${rec.file.name}".`
          : m.reason === 'name'
            ? `That file is called "${file.name}". Pick "${rec.file.name}".`
            : `"${file.name}" has changed since the upload started. Discard and upload it fresh.`;
      }
      const plan = planParts(file.size, rec.part_size);
      job.current = {
        videoId: rec.video_id,
        uploadId: rec.upload_id,
        file,
        plan,
        urls: new Map(),
        done: new Set(),
        loaded: new Map(),
        ctrl: null,
        refreshed: false,
        record: rec,
      };
      samples.current = [];
      setView({
        ...INITIAL,
        phase: 'uploading',
        videoId: rec.video_id,
        fileName: file.name,
        totalBytes: file.size,
        partCount: plan.length,
      });
      try {
        const v = await api.get<Video>(`/videos/${rec.video_id}`);
        if (v.state !== 'uploading') {
          clearResumeRecord();
          if (v.state === 'processing') {
            patch({ phase: 'processing', sentBytes: file.size, partsDone: plan.length });
            watchProcessing(rec.video_id);
          } else if (v.state === 'ready') patch({ phase: 'ready', sentBytes: file.size });
          else if (v.state === 'published') patch({ phase: 'published', sentBytes: file.size });
          else patch({ phase: 'failed', message: FAILED_PROCESSING });
          return null;
        }
      } catch (err) {
        if (online()) {
          job.current = null;
          clearResumeRecord();
          setView(INITIAL);
          return `That upload can't be continued (${errorMessage(err, 'not found')}). Start it again.`;
        }
        pauseWith('offline');
        return null;
      }
      await resume();
      return null;
    },
    [patch, resume, pauseWith, watchProcessing],
  );

  const pause = useCallback(() => pauseWith('user'), [pauseWith]);

  const cancel = useCallback(async () => {
    const j = job.current;
    stopPolling();
    if (j?.ctrl) {
      const c = j.ctrl;
      j.ctrl = null;
      c.abort();
    }
    job.current = null;
    clearResumeRecord();
    setView(INITIAL);
    if (j) {
      await api
        .post(`/videos/${j.videoId}/upload/multipart/${encodeURIComponent(j.uploadId)}/abort`)
        .catch(() => undefined);
    }
  }, [stopPolling]);

  const publish = useCallback(async () => {
    const id = viewRef.current.videoId;
    if (!id) return;
    patch({ phase: 'publishing', message: null });
    try {
      await api.post(`/videos/${id}/publish`);
      patch({ phase: 'published' });
    } catch (err) {
      patch({
        phase: 'ready',
        message: `Couldn't publish: ${errorMessage(err, 'unknown error')}.`,
      });
    }
  }, [patch]);

  const reset = useCallback(() => {
    stopPolling();
    job.current = null;
    setView(INITIAL);
  }, [stopPolling]);

  /** Keep the typed details with the resume record, so a refresh doesn't lose them. */
  const saveDraft = useCallback((draft: UploadDraft) => {
    const j = job.current;
    if (!j || !['uploading', 'paused', 'starting'].includes(viewRef.current.phase)) return;
    j.record = { ...j.record, draft };
    writeRecord(j.record);
  }, []);

  // Network: pause the moment we go offline; carry on when we're back.
  useEffect(() => {
    const onOffline = () => {
      if (job.current?.ctrl) pauseWith('offline');
    };
    const onOnline = () => {
      const v = viewRef.current;
      if (v.phase === 'paused' && v.pauseReason === 'offline') void resume();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [pauseWith, resume]);

  // Leaving mid-upload pauses it; warn first.
  const busy =
    view.phase === 'uploading' || view.phase === 'starting' || view.phase === 'finishing';
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);

  // Keep the screen on while bytes are moving: a sleeping phone stalls the upload.
  const uploading = view.phase === 'uploading';
  useEffect(() => {
    if (!uploading) return;
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    (navigator as WakeLockNavigator).wakeLock
      ?.request('screen')
      .then((l) => {
        if (cancelled) void l.release().catch(() => undefined);
        else lock = l;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void lock?.release().catch(() => undefined);
    };
  }, [uploading]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.ctrl?.abort();
      if (emitTimer.current) clearTimeout(emitTimer.current);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  return { view, start, resumeFrom, pause, resume, cancel, publish, reset, saveDraft };
}
