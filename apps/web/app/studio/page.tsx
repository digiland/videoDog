'use client';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../../src/lib/api';
import { formatDuration } from '../../src/lib/format';
import type { Earnings, Video } from '../../src/types/api';
import { AccessChip } from '../../src/ui/access-chip';
import { Button, LinkButton } from '../../src/ui/button';
import { Icon } from '../../src/ui/icon';
import { Notice } from '../../src/ui/notice';
import { Price } from '../../src/ui/price';
import { EmptyState, Skeleton } from '../../src/ui/state';
import {
  type BalanceResponse,
  errorMessage,
  fetchBalance,
  fetchEarnings,
  fetchMyVideos,
  monthLabel,
  nextAction,
  shortDate,
  thisMonth,
  usdBalance,
} from './_components/studio-data';
import { SectionTitle, Stat, StateChip, VideoThumb } from './_components/ui';
import { readResumeRecord } from './_components/use-resumable-upload';

export default function StudioHome() {
  const month = thisMonth();
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, b, v] = await Promise.allSettled([
      fetchEarnings(month),
      fetchBalance(),
      fetchMyVideos(50),
    ]);
    if (e.status === 'fulfilled') setEarnings(e.value);
    if (b.status === 'fulfilled') setBalance(b.value);
    if (v.status === 'fulfilled') setVideos(v.value.items);
    else setVideos([]);
    const failed = [e, b, v].find((r) => r.status === 'rejected');
    setError(
      failed && failed.status === 'rejected' ? errorMessage(failed.reason, 'Network error') : null,
    );
  }, [month]);

  useEffect(() => {
    void load();
    setResumeId(readResumeRecord()?.video_id ?? null);
  }, [load]);

  async function publish(id: string) {
    setBusy(id);
    try {
      await api.post(`/videos/${id}/publish`);
      await load();
    } catch (err) {
      setError(`Couldn't publish: ${errorMessage(err, 'try again')}.`);
    } finally {
      setBusy(null);
    }
  }

  const count = (s: Video['state']) => videos?.filter((v) => v.state === s).length ?? 0;
  const processing = count('processing') + count('uploading');
  const attention = (videos ?? []).filter(
    (v) =>
      v.state === 'ready' || v.state === 'failed' || (v.state === 'uploading' && v.id === resumeId),
  );
  const recent = (videos ?? []).filter((v) => !attention.includes(v)).slice(0, 6);
  const loading = videos === null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Studio</h1>
        <LinkButton href="/studio/upload" icon="upload" className="hidden sm:inline-flex">
          Upload video
        </LinkButton>
      </div>

      {error && <Notice tone="error">Some numbers didn&rsquo;t load: {error}</Notice>}

      <section aria-label="Numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          emphasis
          label={`Earned in ${monthLabel(month).split(' ')[0]}`}
          value={earnings ? <Price money={earnings.total} /> : <Skeleton className="h-8 w-24" />}
          sub={
            <Link href="/studio/earnings" className="hover:text-ink">
              See breakdown
            </Link>
          }
        />
        <Stat
          emphasis
          label="Balance"
          value={
            balance ? <Price money={usdBalance(balance)} /> : <Skeleton className="h-8 w-24" />
          }
          sub={
            <Link href="/studio/payouts" className="hover:text-ink">
              Withdraw to EcoCash
            </Link>
          }
        />
        <Stat
          label="Published"
          value={loading ? <Skeleton className="h-7 w-10" /> : count('published')}
        />
        <Stat
          label="Processing"
          value={loading ? <Skeleton className="h-7 w-10" /> : processing}
          sub={count('ready') > 0 ? `${count('ready')} ready to publish` : undefined}
        />
      </section>

      <LinkButton href="/studio/upload" icon="upload" size="lg" block className="sm:hidden">
        Upload video
      </LinkButton>

      {attention.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Needs you</SectionTitle>
          <ul className="flex flex-col divide-y divide-line rounded border border-line bg-surface">
            {attention.map((v) => (
              <VideoLine key={v.id} video={v}>
                <NextStep
                  video={v}
                  busy={busy === v.id}
                  canResume={resumeId === v.id}
                  onPublish={() => void publish(v.id)}
                />
              </VideoLine>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            <Link
              href="/studio/videos"
              className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-accent"
            >
              All videos <Icon name="chevronRight" size={16} />
            </Link>
          }
        >
          Recent videos
        </SectionTitle>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="rounded border border-line bg-surface">
            <EmptyState
              title="No videos yet"
              action={
                <LinkButton href="/studio/upload" icon="upload">
                  Upload your first video
                </LinkButton>
              }
            >
              Upload from your phone. If the connection drops, it carries on where it stopped.
            </EmptyState>
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-ink-3">Everything is listed above.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded border border-line bg-surface">
            {recent.map((v) => (
              <VideoLine key={v.id} video={v}>
                <NextStep
                  video={v}
                  busy={busy === v.id}
                  canResume={resumeId === v.id}
                  onPublish={() => void publish(v.id)}
                />
              </VideoLine>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function VideoLine({ video, children }: { video: Video; children: ReactNode }) {
  const price =
    video.ppv_price_minor_units && video.ppv_price_currency
      ? { amount_minor: video.ppv_price_minor_units, currency: video.ppv_price_currency }
      : null;
  return (
    <li className="flex items-center gap-3 p-3">
      <VideoThumb src={video.thumbnail_url} className="w-20 sm:w-28" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="line-clamp-2 text-sm font-semibold text-ink">{video.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <StateChip state={video.state} />
          <span className="hidden sm:inline-flex">
            <AccessChip mode={video.access_mode} price={price} />
          </span>
          <span className="num">
            {video.duration_seconds != null && `${formatDuration(video.duration_seconds)} · `}
            {shortDate(video.published_at ?? video.created_at)}
          </span>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function NextStep({
  video,
  busy,
  canResume,
  onPublish,
}: {
  video: Video;
  busy: boolean;
  canResume: boolean;
  onPublish: () => void;
}) {
  const a = nextAction(video.state);
  switch (a.kind) {
    case 'publish':
    case 'republish':
      return (
        <Button onClick={onPublish} loading={busy}>
          Publish
        </Button>
      );
    case 'resume-upload':
      return canResume ? (
        <LinkButton href="/studio/upload" variant="secondary">
          Resume
        </LinkButton>
      ) : (
        <span className="text-xs text-ink-3">Not finished</span>
      );
    case 'reupload':
      return (
        <LinkButton href="/studio/upload" variant="secondary">
          Upload again
        </LinkButton>
      );
    case 'wait':
      return <span className="text-xs text-ink-3">A few minutes</span>;
    default:
      return (
        <Link
          href={`/v/${video.id}`}
          aria-label={`View ${video.title}`}
          className="inline-flex h-11 w-11 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="chevronRight" size={18} />
        </Link>
      );
  }
}
