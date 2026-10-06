import { describe, expect, it, vi } from 'vitest';
import {
  AbortError,
  PartHttpError,
  RESUME_MAX_AGE_MS,
  backoffDelay,
  bytesUploaded,
  etaSeconds,
  formatEta,
  formatMB,
  isRetryable,
  matchResume,
  parseResumeRecord,
  percent,
  planParts,
  retrySchedule,
  runPool,
  titleFromFileName,
  withRetry,
  type ResumeRecord,
} from './upload';

const MiB = 1024 * 1024;

describe('planParts', () => {
  it('cuts a file into 8 MiB parts with a short last part', () => {
    const plan = planParts(20 * MiB, 8 * MiB);
    expect(plan).toEqual([
      { part_number: 1, start: 0, end: 8 * MiB, size: 8 * MiB },
      { part_number: 2, start: 8 * MiB, end: 16 * MiB, size: 8 * MiB },
      { part_number: 3, start: 16 * MiB, end: 20 * MiB, size: 4 * MiB },
    ]);
  });

  it('matches the server count (ceil) and covers every byte once', () => {
    for (const size of [1, 8 * MiB - 1, 8 * MiB, 8 * MiB + 1, 123_456_789]) {
      const plan = planParts(size, 8 * MiB);
      expect(plan.length).toBe(Math.ceil(size / (8 * MiB)));
      expect(plan.reduce((s, p) => s + p.size, 0)).toBe(size);
      expect(plan.at(-1)?.end).toBe(size);
    }
  });

  it('rejects empty files and bad part sizes', () => {
    expect(() => planParts(0, 8 * MiB)).toThrow(RangeError);
    expect(() => planParts(10, 0)).toThrow(RangeError);
  });
});

describe('backoff', () => {
  it('grows 1s, 3s, 9s and caps', () => {
    expect([1, 2, 3].map((r) => backoffDelay(r))).toEqual([1000, 3000, 9000]);
    expect(backoffDelay(10)).toBe(30_000);
  });

  it('jitter stays within the spread', () => {
    expect(backoffDelay(1, { jitter: 0.5, random: () => 0 })).toBe(500);
    expect(backoffDelay(1, { jitter: 0.5, random: () => 1 })).toBe(1500);
  });

  it('3 attempts means two waits', () => {
    expect(retrySchedule(3)).toEqual([1000, 3000]);
    expect(retrySchedule(1)).toEqual([]);
  });
});

describe('progress', () => {
  const plan = planParts(20 * MiB, 8 * MiB);

  it('counts finished parts fully and clamps in-flight bytes', () => {
    const done = new Set([1]);
    const loaded = new Map([
      [2, 1 * MiB],
      [3, 99 * MiB],
    ]);
    expect(bytesUploaded(plan, done, loaded)).toBe(8 * MiB + 1 * MiB + 4 * MiB);
  });

  it('percent only says 100 when complete', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(999, 1000)).toBe(99);
    expect(percent(1000, 1000)).toBe(100);
    expect(percent(333, 1000)).toBe(33);
  });

  it('formats decimal megabytes', () => {
    expect(formatMB(2_450_000)).toBe('2.5 MB');
    expect(formatMB(245_300_000)).toBe('245 MB');
    expect(formatMB(1_234_000_000)).toBe('1,234 MB');
  });
});

describe('resume records', () => {
  const now = 1_800_000_000_000;
  const rec: ResumeRecord = {
    v: 1,
    video_id: 'v1',
    upload_id: 'u1',
    part_count: 3,
    part_size: 8 * MiB,
    file: { name: 'show.mp4', size: 20 * MiB, lastModified: 1234 },
    saved_at: now - 1000,
  };

  it('round-trips a valid record', () => {
    expect(parseResumeRecord(JSON.stringify(rec), now)).toEqual(rec);
  });

  it('drops malformed, stale or inconsistent records', () => {
    expect(parseResumeRecord(null, now)).toBeNull();
    expect(parseResumeRecord('{nope', now)).toBeNull();
    expect(parseResumeRecord(JSON.stringify({ ...rec, v: 2 }), now)).toBeNull();
    expect(parseResumeRecord(JSON.stringify({ ...rec, upload_id: 5 }), now)).toBeNull();
    expect(
      parseResumeRecord(JSON.stringify({ ...rec, saved_at: now - RESUME_MAX_AGE_MS - 1 }), now),
    ).toBeNull();
    expect(parseResumeRecord(JSON.stringify({ ...rec, part_count: 4 }), now)).toBeNull();
  });

  it('matches only the very same file', () => {
    expect(matchResume(rec, rec.file)).toEqual({ ok: true });
    expect(matchResume(rec, { ...rec.file, size: 1 })).toEqual({ ok: false, reason: 'size' });
    expect(matchResume(rec, { ...rec.file, name: 'x.mp4' })).toEqual({
      ok: false,
      reason: 'name',
    });
    expect(matchResume(rec, { ...rec.file, lastModified: 9 })).toEqual({
      ok: false,
      reason: 'modified',
    });
  });

  it('derives a title from the file name', () => {
    expect(titleFromFileName('my_show-ep1.mp4')).toBe('my show ep1');
    expect(titleFromFileName('.mp4')).toBe('Untitled video');
  });
});

describe('isRetryable', () => {
  it('retries network, throttling and server errors only', () => {
    expect(isRetryable(new PartHttpError(0, 1))).toBe(true);
    expect(isRetryable(new PartHttpError(503, 1))).toBe(true);
    expect(isRetryable(new PartHttpError(429, 1))).toBe(true);
    expect(isRetryable(new PartHttpError(403, 1))).toBe(false);
    expect(isRetryable(new PartHttpError(400, 1))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
    expect(new PartHttpError(403, 1).needsFreshUrl).toBe(true);
  });
});

describe('withRetry', () => {
  const noWait = () => Promise.resolve();

  it('retries until success and reports each retry with its delay', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new PartHttpError(0, 7);
        return 'ok';
      },
      { onRetry, wait: noWait },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(onRetry.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [2, 1000],
      [3, 3000],
    ]);
  });

  it('gives up after the last attempt with the last error', async () => {
    const err = new PartHttpError(500, 2);
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err;
        },
        { wait: noWait },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new PartHttpError(403, 1);
        },
        { wait: noWait },
      ),
    ).rejects.toBeInstanceOf(PartHttpError);
    expect(calls).toBe(1);
  });

  it('stops when aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(withRetry(async () => 1, { signal: ctrl.signal })).rejects.toBeInstanceOf(
      AbortError,
    );
  });
});

describe('runPool', () => {
  const tick = () => new Promise((r) => setTimeout(r, 1));

  it('never runs more than `limit` at once and runs everything', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      seen.push(n);
      active--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops taking new work after a failure, aborts siblings and rejects with it', async () => {
    const started: number[] = [];
    const aborted: number[] = [];
    const boom = new Error('part 2 failed');
    await expect(
      runPool([1, 2, 3, 4, 5, 6], 2, async (n, signal) => {
        started.push(n);
        if (n === 2) throw boom;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 20);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            aborted.push(n);
            resolve();
          });
        });
      }),
    ).rejects.toBe(boom);
    expect(started).toEqual([1, 2]);
    expect(aborted).toEqual([1]);
  });

  it('rejects with AbortError when the caller aborts (pause)', async () => {
    const ctrl = new AbortController();
    const p = runPool(
      [1, 2, 3],
      2,
      async (_n, signal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      },
      ctrl.signal,
    );
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
  });

  it('handles an empty list', async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe('eta', () => {
  it('uses the speed over the sample window', () => {
    const samples = [
      { at: 0, bytes: 0 },
      { at: 5000, bytes: 5_000_000 },
    ];
    expect(etaSeconds(samples, 65_000_000)).toBe(60);
  });

  it('waits for at least two seconds of signal and real progress', () => {
    expect(etaSeconds([], 10)).toBeNull();
    expect(
      etaSeconds(
        [
          { at: 0, bytes: 0 },
          { at: 1000, bytes: 9 },
        ],
        10,
      ),
    ).toBeNull();
    expect(
      etaSeconds(
        [
          { at: 0, bytes: 5 },
          { at: 5000, bytes: 5 },
        ],
        10,
      ),
    ).toBeNull();
  });

  it('rounds for humans', () => {
    expect(formatEta(12)).toBe('≈ 15 s left');
    expect(formatEta(61)).toBe('≈ 2 min left');
    expect(formatEta(4 * 3600)).toBe('≈ 4 h left');
  });
});
