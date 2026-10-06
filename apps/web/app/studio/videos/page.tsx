'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import { formatDuration } from '../../../src/lib/format';
import { formatMinorToMajorInput, minorToJsonNumber } from '../../../src/lib/money-input';
import type { Video } from '../../../src/types/api';
import { AccessChip } from '../../../src/ui/access-chip';
import { Button, LinkButton } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { Icon } from '../../../src/ui/icon';
import { Notice } from '../../../src/ui/notice';
import { EmptyState, Skeleton } from '../../../src/ui/state';
import { AccessModePicker } from '../_components/AccessModePicker';
import {
  type AccessMode,
  errorMessage,
  fetchMe,
  fetchMyVideos,
  needsPrice,
  parsePpvPrice,
  shortDate,
} from '../_components/studio-data';
import { PageTitle, StateChip, VideoThumb } from '../_components/ui';

type Edit = { title: string; mode: AccessMode; price: string; thumb: File | null };

function priceOf(v: Video) {
  return v.ppv_price_minor_units && v.ppv_price_currency
    ? { amount_minor: v.ppv_price_minor_units, currency: v.ppv_price_currency }
    : null;
}

export default function StudioVideosPage() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchMyVideos(100);
      setVideos(page.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Network error'));
      setVideos((v) => v ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchMe()
      .then((me) => setCurrency(me.canonical_pricing_currency ?? 'USD'))
      .catch(() => undefined);
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

  const rowProps = (v: Video) => ({
    video: v,
    busy: busy === v.id,
    editing: editing === v.id,
    onPublish: () => void publish(v.id),
    onEdit: () => setEditing(editing === v.id ? null : v.id),
  });

  const editor = (v: Video) => (
    <EditPanel
      video={v}
      currency={currency}
      onClose={() => setEditing(null)}
      onSaved={async () => {
        setEditing(null);
        await load();
      }}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Videos"
        action={
          <LinkButton href="/studio/upload" icon="upload" className="hidden sm:inline-flex">
            Upload video
          </LinkButton>
        }
      >
        Publish, change prices and add captions.
      </PageTitle>

      {error && <Notice tone="error">{error}</Notice>}

      {videos === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
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
            Your uploads show here with what to do next.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {videos.map((v) => (
              <li key={v.id} className="rounded border border-line bg-surface">
                <VideoCardRow {...rowProps(v)} />
                {editing === v.id && <div className="border-t border-line p-4">{editor(v)}</div>}
              </li>
            ))}
          </ul>

          {/* Wide screens: a table in its own scroll container */}
          <div className="hidden overflow-x-auto rounded border border-line md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Video
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    State
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Access
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">
                    Length
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {videos.map((v) => (
                  <TableRows key={v.id} {...rowProps(v)} editor={editor(v)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

type RowProps = {
  video: Video;
  busy: boolean;
  editing: boolean;
  onPublish: () => void;
  onEdit: () => void;
};

function Actions({ video, busy, editing, onPublish, onEdit }: RowProps) {
  const canPublish = video.state === 'ready' || video.state === 'unpublished';
  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {canPublish && (
        <Button onClick={onPublish} loading={busy} className="flex-1 md:flex-none">
          Publish
        </Button>
      )}
      {video.state === 'failed' && (
        <LinkButton href="/studio/upload" variant="secondary" className="flex-1 md:flex-none">
          Upload again
        </LinkButton>
      )}
      <Button
        variant="secondary"
        onClick={onEdit}
        aria-expanded={editing}
        className="flex-1 md:flex-none"
      >
        {editing ? 'Close' : 'Edit'}
      </Button>
      <LinkButton
        href={`/studio/videos/${video.id}/captions`}
        variant="ghost"
        icon="captions"
        className="flex-1 md:flex-none"
      >
        Captions
      </LinkButton>
    </div>
  );
}

function Meta({ video }: { video: Video }) {
  return (
    <span className="num text-xs text-ink-3">
      {video.duration_seconds != null && `${formatDuration(video.duration_seconds)} · `}
      {shortDate(video.published_at ?? video.created_at)}
    </span>
  );
}

function VideoCardRow(props: RowProps) {
  const { video } = props;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-3">
        <VideoThumb src={video.thumbnail_url} className="w-28" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="line-clamp-2 text-sm font-semibold text-ink">{video.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StateChip state={video.state} />
            <AccessChip mode={video.access_mode} price={priceOf(video)} />
          </div>
          <Meta video={video} />
        </div>
      </div>
      <Actions {...props} />
    </div>
  );
}

function TableRows(props: RowProps & { editor: React.ReactNode }) {
  const { video, editing, editor } = props;
  return (
    <>
      <tr className="bg-bg">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            <VideoThumb src={video.thumbnail_url} className="w-24" />
            {video.state === 'published' ? (
              <Link
                href={`/v/${video.id}`}
                className="line-clamp-2 max-w-xs font-semibold text-ink hover:text-accent"
              >
                {video.title}
              </Link>
            ) : (
              <span className="line-clamp-2 max-w-xs font-semibold text-ink">{video.title}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <StateChip state={video.state} />
        </td>
        <td className="px-3 py-2.5">
          <AccessChip mode={video.access_mode} price={priceOf(video)} />
        </td>
        <td className="num px-3 py-2.5 text-right text-ink-2">
          {video.duration_seconds != null ? formatDuration(video.duration_seconds) : '—'}
        </td>
        <td className="num whitespace-nowrap px-3 py-2.5 text-ink-2">
          {shortDate(video.published_at ?? video.created_at)}
        </td>
        <td className="px-3 py-2.5">
          <Actions {...props} />
        </td>
      </tr>
      {editing && (
        <tr className="bg-surface">
          <td colSpan={6} className="p-4">
            {editor}
          </td>
        </tr>
      )}
    </>
  );
}

function EditPanel({
  video,
  currency,
  onClose,
  onSaved,
}: {
  video: Video;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<Edit>({
    title: video.title,
    mode: video.access_mode,
    price: video.ppv_price_minor_units ? formatMinorToMajorInput(video.ppv_price_minor_units) : '',
    thumb: null,
  });
  const [priceError, setPriceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const title = edit.title.trim();
    if (!title) return setError('Give the video a title.');
    const body: Record<string, unknown> = {
      title,
      access_mode: edit.mode,
      ppv_price_minor_units: null,
      ppv_price_currency: null,
    };
    if (needsPrice(edit.mode)) {
      const p = parsePpvPrice(edit.price, currency);
      if (!p.ok) return setPriceError(p.error);
      // JSON number only at the API boundary; PPV prices are ≤ 200 minor units.
      body.ppv_price_minor_units = minorToJsonNumber(p.minor);
      body.ppv_price_currency = currency;
    }
    setSaving(true);
    try {
      if (edit.thumb) {
        const { upload_url, key } = await api.post<{ upload_url: string; key: string }>(
          `/videos/${video.id}/thumbnail`,
        );
        const put = await fetch(upload_url, {
          method: 'PUT',
          headers: { 'content-type': edit.thumb.type },
          body: edit.thumb,
        });
        if (!put.ok) throw new Error('Thumbnail upload failed');
        await api.post(`/videos/${video.id}/thumbnail/complete`, { key });
      }
      await api.patch(`/videos/${video.id}`, body);
      await onSaved();
    } catch (err) {
      setError(`Not saved: ${errorMessage(err, 'try again')}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex max-w-2xl flex-col gap-4">
      <Field
        label="Title"
        value={edit.title}
        maxLength={255}
        onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))}
      />
      <AccessModePicker
        idPrefix={`edit-${video.id}`}
        mode={edit.mode}
        onMode={(mode) => {
          setEdit((s) => ({ ...s, mode }));
          setPriceError(null);
        }}
        price={edit.price}
        onPrice={(price) => {
          setEdit((s) => ({ ...s, price }));
          setPriceError(null);
        }}
        currency={currency}
        error={priceError}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Thumbnail</span>
        <label className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded border border-line bg-surface-2 px-4 text-sm font-semibold text-ink hover:bg-line focus-within:outline focus-within:outline-2 focus-within:outline-accent">
          <input
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={(e) => {
              const thumb = e.target.files?.[0] ?? null;
              setEdit((s) => ({ ...s, thumb }));
            }}
          />
          <Icon name="upload" size={16} />
          {edit.thumb ? 'Change image' : 'Choose image'}
        </label>
        <p className="text-xs text-ink-3 break-all">
          {edit.thumb ? edit.thumb.name : 'JPG or PNG, 16:9. Optional.'}
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
