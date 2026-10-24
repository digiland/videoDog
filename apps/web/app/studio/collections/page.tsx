'use client';
import type { ContentCategory } from '@streamzw/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import type { CollectionListResponse, CollectionSummary } from '../../../src/types/api';
import { Button } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { Icon } from '../../../src/ui/icon';
import { Notice } from '../../../src/ui/notice';
import { Segmented } from '../../../src/ui/segmented';
import { EmptyState, Skeleton } from '../../../src/ui/state';
import { collectionMeta } from '../../components/viewer/CollectionCard';
import { CategorySelect } from '../_components/CategorySelect';
import { errorMessage } from '../_components/studio-data';
import { CollectionStateChip, PageTitle, VideoThumb } from '../_components/ui';

/** The creator's courses and playlists, plus a short form to start a new one. */
export default function StudioCollectionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<CollectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'course' | 'playlist'>('course');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ContentCategory>('education');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .get<CollectionListResponse>('/collections?creator=me')
      .then((r) => setItems(r.items))
      .catch((err) => setError(errorMessage(err, 'Could not load your courses')));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError('Give it a title.');
    setCreating(true);
    setError(null);
    try {
      const c = await api.post<CollectionSummary>('/collections', {
        kind,
        title: title.trim(),
        category,
      });
      router.push(`/studio/collections/${c.id}`);
    } catch (err) {
      setError(`Not created: ${errorMessage(err, 'try again')}.`);
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageTitle title="Courses & playlists">
        Group your videos into a course with sections (like &ldquo;Paper 1 → Algebra&rdquo;) or a
        simple playlist. Each video keeps its own price: free lessons bring viewers in, Premium and
        pay-once lessons earn.
      </PageTitle>

      <form
        onSubmit={(e) => void create(e)}
        className="flex flex-col gap-4 rounded border border-line bg-surface p-4 sm:p-5"
      >
        <h2 className="text-base font-semibold text-ink">Start a new one</h2>
        <Segmented
          legend="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'course', label: 'Course' },
            { value: 'playlist', label: 'Playlist' },
          ]}
        />
        <Field
          label="Title"
          value={title}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(null);
          }}
          placeholder={kind === 'course' ? 'e.g. O-Level Maths: Paper 1' : 'e.g. Best of 2026'}
          error={titleError}
        />
        <CategorySelect id="new-category" value={category} onChange={setCategory} />
        <div>
          <Button type="submit" loading={creating} icon="plus">
            Create {kind}
          </Button>
        </div>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {items === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No courses or playlists yet">
          Create one above, then add your videos to it.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded border border-line">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/studio/collections/${c.id}`}
                className="flex items-center gap-4 p-3 transition-colors hover:bg-surface"
              >
                <VideoThumb src={c.thumbnail_url} className="w-28 sm:w-40" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <Icon name={c.kind === 'course' ? 'course' : 'playlist'} size={14} />
                    {c.kind}
                  </p>
                  <p className="truncate font-semibold text-ink">{c.title}</p>
                  <p className="text-xs text-ink-3 num">{collectionMeta(c)} published</p>
                </div>
                <CollectionStateChip state={c.state} />
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
