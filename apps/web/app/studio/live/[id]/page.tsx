'use client';
import { resolutionLabel } from '@streamzw/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../src/lib/api';
import { startsAt, timeAgo } from '../../../../src/lib/format';
import type { LiveStream } from '../../../../src/types/api';
import { Button, LinkButton } from '../../../../src/ui/button';
import { Icon } from '../../../../src/ui/icon';
import { Notice } from '../../../../src/ui/notice';
import { Skeleton } from '../../../../src/ui/state';
import { IngestSettings } from '../../_components/IngestSettings';
import { errorMessage } from '../../_components/studio-data';
import { PageTitle } from '../../_components/ui';

/** The control room: is the feed arriving, at what quality, and the buttons that matter. */
export default function LiveControlRoom() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<LiveStream | null>(null);
  const [key, setKey] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api.get<LiveStream>(`/live/streams/${id}`));
    } catch (err) {
      setError(errorMessage(err, 'Could not load this stream'));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<LiveStream>(`/live/streams/${id}/${path}`);
      if (next.stream_key) setKey(next.stream_key);
      setS(next);
    } catch (err) {
      setError(errorMessage(err, 'That did not work, try again'));
    } finally {
      setBusy(false);
    }
  }

  if (!s) {
    return error ? <Notice tone="error">{error}</Notice> : <Skeleton className="h-48" />;
  }
  const i = s.ingest;
  const open = s.state === 'scheduled' || s.state === 'live';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/studio/live" className="text-sm font-semibold text-ink-3 hover:text-ink">
          ← Live
        </Link>
        <PageTitle
          title={s.video?.title ?? 'Live stream'}
          action={
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/v/${s.video_id}`} size="sm" variant="secondary">
                Viewer page
              </LinkButton>
              {s.state === 'live' && (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  onClick={() => void act('end', 'End the stream for everyone now?')}
                >
                  End stream
                </Button>
              )}
              {s.state === 'scheduled' && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  onClick={() => void act('cancel', 'Cancel this stream? It leaves the catalogue.')}
                >
                  Cancel stream
                </Button>
              )}
            </div>
          }
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded border border-line bg-surface p-4">
          <span className="text-xs font-semibold text-ink-3">Status</span>
          <span className="flex items-center gap-2 text-xl font-bold text-ink">
            {s.state === 'live' && <span className="h-2.5 w-2.5 rounded-full bg-danger" />}
            {s.state === 'scheduled'
              ? 'Upcoming'
              : s.state === 'live'
                ? 'On air'
                : s.state === 'ended'
                  ? 'Ended'
                  : 'Cancelled'}
          </span>
          <span className="text-xs text-ink-3">
            {s.state === 'scheduled' &&
              (s.scheduled_at ? `Starts ${startsAt(s.scheduled_at)}` : 'Starts when you go live')}
            {s.state === 'live' && s.started_at && `Since ${timeAgo(s.started_at)}`}
            {s.state === 'ended' &&
              (s.recording_state === 'ready'
                ? 'Replay published'
                : s.recording_state === 'pending'
                  ? 'Preparing the replay…'
                  : s.record
                    ? 'Replay not available'
                    : 'Not recorded')}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded border border-line bg-surface p-4">
          <span className="text-xs font-semibold text-ink-3">Your feed</span>
          <span className="flex items-center gap-2 text-xl font-bold text-ink">
            <Icon name="live" size={20} className={i.connected ? 'text-sage' : 'text-ink-3'} />
            {i.connected ? 'Receiving' : 'Not connected'}
          </span>
          <span className="text-xs text-ink-3 num">
            {i.connected && i.height
              ? `${i.width}×${i.height}${i.fps ? ` @ ${i.fps}fps` : ''} · ${i.codec ?? ''}`
              : i.last_seen_at
                ? `Last seen ${timeAgo(i.last_seen_at)}`
                : 'Start streaming from OBS'}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded border border-line bg-surface p-4">
          <span className="text-xs font-semibold text-ink-3">Viewers get</span>
          <span className="text-xl font-bold text-ink">
            {i.height ? `Up to ${resolutionLabel(Math.min(i.height, 2160))}` : '—'}
          </span>
          <span className="text-xs text-ink-3">Plus smaller versions down to 240p for phones.</span>
        </div>
      </section>

      {open && (
        <section className="flex flex-col gap-4 rounded border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Encoder settings</h2>
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() =>
                void act('key', 'Reset the stream key? Your encoder must use the new one.')
              }
            >
              Reset stream key
            </Button>
          </div>
          <IngestSettings stream={s} streamKey={key} />
        </section>
      )}
    </div>
  );
}
