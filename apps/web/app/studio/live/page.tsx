'use client';
import type { ContentCategory } from '@streamzw/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import { startsAt } from '../../../src/lib/format';
import { minorToJsonNumber } from '../../../src/lib/money-input';
import type { LiveStream } from '../../../src/types/api';
import { Button } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { Icon } from '../../../src/ui/icon';
import { LiveBadge } from '../../../src/ui/live-badge';
import { Notice } from '../../../src/ui/notice';
import { EmptyState, Skeleton } from '../../../src/ui/state';
import { AccessModePicker } from '../_components/AccessModePicker';
import { CategorySelect } from '../_components/CategorySelect';
import { IngestSettings } from '../_components/IngestSettings';
import {
  type AccessMode,
  errorMessage,
  fetchMe,
  needsPrice,
  parsePpvPrice,
} from '../_components/studio-data';
import { PageTitle, VideoThumb } from '../_components/ui';

const STATE_TEXT: Record<LiveStream['state'], string> = {
  scheduled: 'Upcoming',
  live: 'Live',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

/** Schedule a live stream and see your past and upcoming ones. */
export default function StudioLivePage() {
  const [streams, setStreams] = useState<LiveStream[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ContentCategory>('other');
  const [mode, setMode] = useState<AccessMode>('free');
  const [price, setPrice] = useState('');
  const [when, setWhen] = useState('');
  const [record, setRecord] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<LiveStream | null>(null);

  const load = useCallback(
    () =>
      api
        .get<{ items: LiveStream[] }>('/live/streams/mine')
        .then((r) => setStreams(r.items))
        .catch((err) => setError(errorMessage(err, 'Could not load your streams'))),
    [],
  );

  useEffect(() => {
    void load();
    fetchMe()
      .then((me) => setCurrency(me.canonical_pricing_currency ?? 'USD'))
      .catch(() => undefined);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Give the stream a title.');
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      access_mode: mode,
      record,
      scheduled_at: when ? new Date(when).toISOString() : null,
    };
    if (needsPrice(mode)) {
      const p = parsePpvPrice(price, currency);
      if (!p.ok) return setPriceError(p.error);
      body.ppv_price_minor_units = minorToJsonNumber(p.minor);
      body.ppv_price_currency = currency;
    }
    setBusy(true);
    try {
      const s = await api.post<LiveStream>('/live/streams', body);
      setCreated(s);
      setTitle('');
      setDescription('');
      setWhen('');
      await load();
    } catch (err) {
      setError(`Not created: ${errorMessage(err, 'try again')}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageTitle title="Live">
        Stream concerts, matches, services and premieres up to 4K. Viewers on phones get smaller
        versions automatically. Paid streams can be bought before they start, and a recording stays
        as a replay.
      </PageTitle>

      {created && (
        <section className="flex flex-col gap-4 rounded border border-accent bg-surface p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Icon name="check" size={18} className="text-sage" />
            &ldquo;{created.video?.title}&rdquo; is ready. Point your encoder here:
          </h2>
          <IngestSettings stream={created} streamKey={created.stream_key} />
          <Link
            href={`/studio/live/${created.id}`}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Open the control room →
          </Link>
        </section>
      )}

      <form
        onSubmit={(e) => void create(e)}
        className="flex flex-col gap-5 rounded border border-line bg-surface p-4 sm:p-5"
      >
        <h2 className="text-base font-semibold text-ink">New live stream</h2>
        <Field
          label="Title"
          value={title}
          maxLength={255}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Gospel night 2026, live from Harare"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="live-desc" className="text-sm font-medium text-ink">
            Description
          </label>
          <textarea
            id="live-desc"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded border border-line bg-surface p-3 text-base text-ink outline-none focus:border-accent"
          />
        </div>
        <CategorySelect id="live-category" value={category} onChange={setCategory} />
        <AccessModePicker
          idPrefix="live"
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setPriceError(null);
          }}
          price={price}
          onPrice={(p) => {
            setPrice(p);
            setPriceError(null);
          }}
          currency={currency}
          error={priceError}
        />
        <Field
          label="Starts (optional)"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          hint="Scheduled streams show as upcoming, so people can share and pre-buy them."
          className="sm:max-w-xs"
        />
        <label className="flex items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          Keep a recording as a replay
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <Button type="submit" icon="live" loading={busy}>
            Create stream
          </Button>
        </div>
      </form>

      {streams === null ? (
        <Skeleton className="h-24" />
      ) : streams.length === 0 ? (
        <EmptyState title="No live streams yet">
          Create one above to get your stream key.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded border border-line">
          {streams.map((s) => (
            <li key={s.id}>
              <Link
                href={`/studio/live/${s.id}`}
                className="flex items-center gap-4 p-3 transition-colors hover:bg-surface"
              >
                <VideoThumb src={s.video?.thumbnail_url ?? null} className="w-28 sm:w-40" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate font-semibold text-ink">{s.video?.title}</p>
                  <p className="text-xs text-ink-3">
                    {STATE_TEXT[s.state]}
                    {s.state === 'scheduled' && s.scheduled_at && ` · ${startsAt(s.scheduled_at)}`}
                    {s.state === 'ended' && s.recording_state === 'ready' && ' · replay published'}
                  </p>
                </div>
                {s.video?.live && <LiveBadge live={s.video.live} />}
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
