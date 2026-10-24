'use client';
import type { ContentCategory } from '@streamzw/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../src/lib/api';
import { formatDuration } from '../../../../src/lib/format';
import type { CollectionDetail, CollectionEntry, Video } from '../../../../src/types/api';
import { AccessChip } from '../../../../src/ui/access-chip';
import { Button, LinkButton } from '../../../../src/ui/button';
import { Field } from '../../../../src/ui/field';
import { Icon, type IconName } from '../../../../src/ui/icon';
import { Notice } from '../../../../src/ui/notice';
import { Skeleton } from '../../../../src/ui/state';
import { videoPrice } from '../../../components/VideoCard';
import { collectionMeta } from '../../../components/viewer/CollectionCard';
import { CategorySelect } from '../../_components/CategorySelect';
import { errorMessage, fetchMyVideos } from '../../_components/studio-data';
import { CollectionStateChip, PageTitle, StateChip, VideoThumb } from '../../_components/ui';

interface Layout {
  unsectioned: string[];
  sections: { id: string; item_ids: string[] }[];
}

function layoutOf(c: CollectionDetail): Layout {
  return {
    unsectioned: c.unsectioned.map((e) => e.id),
    sections: c.sections.map((s) => ({ id: s.id, item_ids: s.items.map((e) => e.id) })),
  };
}

function swap<T>(list: T[], i: number, j: number): T[] {
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j] as T, out[i] as T];
  return out;
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'text-ink-2',
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded transition-colors hover:bg-surface-2 disabled:opacity-30 ${tone}`}
    >
      <Icon name={icon} size={18} label={label} />
    </button>
  );
}

/**
 * Course / playlist editor. Every change saves straight away (no Save button to forget):
 * reorders send the whole layout, so a stale tab gets a clear "reload" error instead of
 * silently dropping a lesson.
 */
export default function CollectionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<CollectionDetail | null>(null);
  const [mine, setMine] = useState<Video[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<{
    title: string;
    description: string;
    category: ContentCategory;
  } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');
  const [addTo, setAddTo] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const detail = await api.get<CollectionDetail>(`/collections/${id}`);
      setC(detail);
      setDetails(
        (d) =>
          d ?? {
            title: detail.title,
            description: detail.description ?? '',
            category: detail.category,
          },
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not load this collection'));
    }
  }, [id]);

  useEffect(() => {
    void load();
    fetchMyVideos(100)
      .then((r) => setMine(r.items))
      .catch(() => undefined);
  }, [load]);

  async function run(action: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError(null);
    setSavedNote(null);
    try {
      await action();
      if (refresh) await load();
    } catch (err) {
      setError(errorMessage(err, 'That did not work, try again'));
    } finally {
      setBusy(false);
    }
  }

  const saveLayout = (layout: Layout) =>
    run(
      async () => setC(await api.put<CollectionDetail>(`/collections/${id}/layout`, layout)),
      false,
    );

  if (!c || !details) {
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const layout = layoutOf(c);
  const inCollection = new Set([
    ...c.unsectioned.map((e) => e.video.id),
    ...c.sections.flatMap((s) => s.items.map((e) => e.video.id)),
  ]);
  const available = mine.filter((v) => !inCollection.has(v.id) && v.state !== 'failed');
  const isCourse = c.kind === 'course';

  function moveItem(entryId: string, dir: -1 | 1) {
    const lists = [
      { key: null as string | null, ids: layout.unsectioned },
      ...layout.sections.map((s) => ({ key: s.id as string | null, ids: s.item_ids })),
    ];
    const list = lists.find((l) => l.ids.includes(entryId));
    if (!list) return;
    const i = list.ids.indexOf(entryId);
    const moved = swap(list.ids, i, i + dir);
    void saveLayout({
      unsectioned: list.key === null ? moved : layout.unsectioned,
      sections: layout.sections.map((s) => (s.id === list.key ? { ...s, item_ids: moved } : s)),
    });
  }

  function moveToSection(entryId: string, target: string | null) {
    const strip = (ids: string[]) => ids.filter((x) => x !== entryId);
    void saveLayout({
      unsectioned:
        target === null ? [...strip(layout.unsectioned), entryId] : strip(layout.unsectioned),
      sections: layout.sections.map((s) => ({
        ...s,
        item_ids: s.id === target ? [...strip(s.item_ids), entryId] : strip(s.item_ids),
      })),
    });
  }

  function moveSection(sectionId: string, dir: -1 | 1) {
    const i = layout.sections.findIndex((s) => s.id === sectionId);
    void saveLayout({ ...layout, sections: swap(layout.sections, i, i + dir) });
  }

  const entryRow = (e: CollectionEntry, index: number, count: number, sectionId: string | null) => (
    <li key={e.id} className="flex items-center gap-3 p-2">
      <VideoThumb src={e.video.thumbnail_url} className="w-24 sm:w-32" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-semibold text-ink">{e.video.title}</p>
        <div className="flex flex-wrap items-center gap-2">
          {e.video.state !== 'published' && <StateChip state={e.video.state} />}
          <AccessChip mode={e.video.access_mode} price={videoPrice(e.video)} />
          {e.video.duration_seconds != null && (
            <span className="text-xs text-ink-3 num">
              {formatDuration(e.video.duration_seconds)}
            </span>
          )}
        </div>
      </div>
      {isCourse && (
        <select
          aria-label={`Section for ${e.video.title}`}
          value={sectionId ?? ''}
          disabled={busy}
          onChange={(ev) => moveToSection(e.id, ev.target.value || null)}
          className="hidden h-9 max-w-40 rounded border border-line bg-surface px-2 text-sm text-ink sm:block"
        >
          <option value="">No section</option>
          {c.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}
      <div className="flex shrink-0">
        <IconButton
          icon="arrowUp"
          label="Move up"
          disabled={busy || index === 0}
          onClick={() => moveItem(e.id, -1)}
        />
        <IconButton
          icon="arrowDown"
          label="Move down"
          disabled={busy || index === count - 1}
          onClick={() => moveItem(e.id, 1)}
        />
        <IconButton
          icon="close"
          label={`Remove ${e.video.title}`}
          disabled={busy}
          tone="text-danger"
          onClick={() => void run(() => api.delete(`/collections/${id}/items/${e.id}`))}
        />
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/studio/collections"
          className="text-sm font-semibold text-ink-3 hover:text-ink"
        >
          ← Courses &amp; playlists
        </Link>
        <PageTitle
          title={c.title}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <CollectionStateChip state={c.state} />
              {c.state === 'published' && (
                <LinkButton href={`/collections/${c.id}`} size="sm" variant="secondary">
                  View
                </LinkButton>
              )}
              {c.state === 'published' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  onClick={() => void run(() => api.post(`/collections/${id}/unpublish`))}
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() => void run(() => api.post(`/collections/${id}/publish`))}
                >
                  Publish
                </Button>
              )}
            </div>
          }
        >
          {isCourse ? 'Course' : 'Playlist'} · {collectionMeta(c)} published. Viewers only see
          published videos.
        </PageTitle>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.patch(`/collections/${id}`, {
              title: details.title.trim(),
              description: details.description.trim() || null,
              category: details.category,
            });
            setSavedNote('Details saved.');
          });
        }}
        className="flex flex-col gap-4 rounded border border-line bg-surface p-4 sm:p-5"
      >
        <h2 className="text-base font-semibold text-ink">Details</h2>
        <Field
          label="Title"
          value={details.title}
          maxLength={120}
          onChange={(e) => setDetails({ ...details, title: e.target.value })}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="col-desc" className="text-sm font-medium text-ink">
            Description
          </label>
          <textarea
            id="col-desc"
            rows={4}
            maxLength={5000}
            value={details.description}
            onChange={(e) => setDetails({ ...details, description: e.target.value })}
            className="rounded border border-line bg-surface p-3 text-base text-ink outline-none focus:border-accent"
          />
        </div>
        <CategorySelect
          id="col-category"
          value={details.category}
          onChange={(category) => setDetails({ ...details, category })}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" loading={busy}>
            Save details
          </Button>
          {savedNote && <span className="text-sm text-sage">{savedNote}</span>}
        </div>
      </form>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold text-ink">{isCourse ? 'Lessons' : 'Videos'}</h2>
        {layout.unsectioned.length > 0 && (
          <ul className="divide-y divide-line rounded border border-line">
            {c.unsectioned.map((e, i) => entryRow(e, i, c.unsectioned.length, null))}
          </ul>
        )}
        {c.sections.map((s, si) => (
          <div key={s.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                aria-label="Section title"
                defaultValue={s.title}
                onBlur={(ev) => {
                  const t = ev.target.value.trim();
                  if (t && t !== s.title) {
                    void run(() => api.patch(`/collections/${id}/sections/${s.id}`, { title: t }));
                  }
                }}
                className="h-10 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 text-base font-bold text-ink outline-none hover:border-line focus:border-accent"
              />
              <IconButton
                icon="arrowUp"
                label="Move section up"
                disabled={busy || si === 0}
                onClick={() => moveSection(s.id, -1)}
              />
              <IconButton
                icon="arrowDown"
                label="Move section down"
                disabled={busy || si === c.sections.length - 1}
                onClick={() => moveSection(s.id, 1)}
              />
              <IconButton
                icon="trash"
                label={`Delete section ${s.title}`}
                disabled={busy || s.items.length > 0}
                tone="text-danger"
                onClick={() => void run(() => api.delete(`/collections/${id}/sections/${s.id}`))}
              />
            </div>
            {s.items.length > 0 ? (
              <ul className="divide-y divide-line rounded border border-line">
                {s.items.map((e, i) => entryRow(e, i, s.items.length, s.id))}
              </ul>
            ) : (
              <p className="rounded border border-dashed border-line p-4 text-sm text-ink-3">
                Empty section. Add videos below and choose this section.
              </p>
            )}
          </div>
        ))}
        {inCollection.size === 0 && c.sections.length === 0 && (
          <p className="rounded border border-dashed border-line p-6 text-center text-sm text-ink-3">
            Nothing here yet. Add videos below.
          </p>
        )}
        {isCourse && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSection.trim()) return;
              void run(async () => {
                await api.post(`/collections/${id}/sections`, { title: newSection.trim() });
                setNewSection('');
              });
            }}
            className="flex items-end gap-2"
          >
            <Field
              label="New section"
              value={newSection}
              maxLength={120}
              placeholder="e.g. Algebra"
              onChange={(e) => setNewSection(e.target.value)}
              className="min-w-0 flex-1 sm:max-w-sm"
            />
            <Button type="submit" variant="secondary" icon="plus" loading={busy}>
              Add section
            </Button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Add your videos</h2>
          {isCourse && c.sections.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              Add to
              <select
                value={addTo}
                onChange={(e) => setAddTo(e.target.value)}
                className="h-9 rounded border border-line bg-surface px-2 text-sm text-ink"
              >
                <option value="">No section</option>
                {c.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-ink-3">
            All your videos are already here.{' '}
            <Link href="/studio/upload" className="font-semibold text-accent hover:underline">
              Upload another
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line">
            {available.map((v) => (
              <li key={v.id} className="flex items-center gap-3 p-2">
                <VideoThumb src={v.thumbnail_url} className="w-24 sm:w-32" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-semibold text-ink">{v.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StateChip state={v.state} />
                    <AccessChip mode={v.access_mode} price={videoPrice(v)} />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.post(`/collections/${id}/items`, {
                        video_id: v.id,
                        section_id: addTo || null,
                      }),
                    )
                  }
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 className="text-base font-semibold text-ink">
          Delete {isCourse ? 'course' : 'playlist'}
        </h2>
        <p className="text-sm text-ink-3">
          Your videos stay published; only this grouping is removed.
        </p>
        <div>
          <Button
            variant="danger"
            icon="trash"
            loading={busy}
            onClick={() => {
              if (!window.confirm(`Delete “${c.title}”? Your videos are not affected.`)) return;
              void run(async () => {
                await api.delete(`/collections/${id}`);
                router.replace('/studio/collections');
              }, false);
            }}
          >
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}
