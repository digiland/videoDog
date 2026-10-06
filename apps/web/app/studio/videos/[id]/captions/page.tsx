'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../../src/lib/api';
import type { Video } from '../../../../../src/types/api';
import { Button } from '../../../../../src/ui/button';
import { Field } from '../../../../../src/ui/field';
import { Icon } from '../../../../../src/ui/icon';
import { Notice } from '../../../../../src/ui/notice';
import { Segmented } from '../../../../../src/ui/segmented';
import { Skeleton } from '../../../../../src/ui/state';
import { errorMessage } from '../../../_components/studio-data';
import { SectionTitle } from '../../../_components/ui';

interface Caption {
  id: string;
  language: string;
  label: string;
  kind: 'subtitles' | 'captions';
  is_default: boolean;
  ready: boolean;
}

const SUGGESTED = [
  { code: 'en', label: 'English' },
  { code: 'sn', label: 'Shona' },
  { code: 'nd', label: 'Ndebele' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
];

export default function CaptionsManagerPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const [title, setTitle] = useState<string | null>(null);
  const [items, setItems] = useState<Caption[] | null>(null);
  const [language, setLanguage] = useState('en');
  const [label, setLabel] = useState('English');
  const [kind, setKind] = useState<'subtitles' | 'captions'>('subtitles');
  const [isDefault, setIsDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: Caption[] }>(`/videos/${videoId}/captions`);
      setItems(data.items);
    } catch (err) {
      setError(errorMessage(err, 'Captions didn’t load'));
      setItems((i) => i ?? []);
    }
  }, [videoId]);

  useEffect(() => {
    void load();
    api
      .get<Video>(`/videos/${videoId}`)
      .then((v) => setTitle(v.title))
      .catch(() => undefined);
  }, [load, videoId]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a .vtt file first.');
      return;
    }
    if (!language.trim() || !label.trim()) {
      setError('Pick a language and give the track a name.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<{ caption_id: string; upload_url: string }>(
        `/videos/${videoId}/captions`,
        { language: language.trim(), label: label.trim(), kind, is_default: isDefault },
      );
      const put = await fetch(created.upload_url, {
        method: 'PUT',
        headers: { 'content-type': 'text/vtt' },
        body: file,
      });
      if (!put.ok) throw new Error('the file upload failed');
      await api.post(`/videos/${videoId}/captions/${created.caption_id}/complete`);
      setSuccess(`Added “${label.trim()}”. Viewers can turn it on from the CC button.`);
      setFile(null);
      await load();
    } catch (err) {
      setError(`Not added: ${errorMessage(err, 'try again')}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    try {
      await api.delete(`/videos/${videoId}/captions/${id}`);
      await load();
    } catch (err) {
      setError(`Not deleted: ${errorMessage(err, 'try again')}.`);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/studio/videos"
          className="inline-flex h-11 w-fit items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink"
        >
          <Icon name="chevronLeft" size={16} /> Videos
        </Link>
        <h1 className="text-2xl font-bold text-ink">Captions</h1>
        {title === null ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <p className="text-sm text-ink-2 line-clamp-2">{title}</p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle>Tracks</SectionTitle>
        {items === null ? (
          <Skeleton className="h-16" />
        ) : items.length === 0 ? (
          <p className="rounded border border-line bg-surface px-4 py-6 text-center text-sm text-ink-2">
            No caption tracks yet. Captions help people watch on mute — and in a second language.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded border border-line bg-surface">
            {items.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Icon name="captions" size={20} className="shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{c.label}</span>
                    <span className="text-xs text-ink-3">{c.language}</span>
                    {c.is_default && (
                      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-xs font-semibold text-accent">
                        Default
                      </span>
                    )}
                    {!c.ready && (
                      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-xs font-semibold text-ink-2">
                        Not finished
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-3">
                    {c.kind === 'captions' ? 'Captions (with sounds)' : 'Subtitles'}
                  </p>
                </div>
                <Button
                  variant={confirmDelete === c.id ? 'danger' : 'ghost'}
                  onClick={() => void handleDelete(c.id)}
                  onBlur={() => setConfirmDelete((d) => (d === c.id ? null : d))}
                >
                  {confirmDelete === c.id ? 'Tap to delete' : 'Delete'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Add a track</SectionTitle>
        <form
          onSubmit={(e) => void handleUpload(e)}
          className="flex flex-col gap-5 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-ink">Language</legend>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  aria-pressed={language === s.code}
                  onClick={() => {
                    setLanguage(s.code);
                    setLabel(s.label);
                  }}
                  className={`h-11 rounded border px-4 text-sm font-semibold transition-colors ${
                    language === s.code
                      ? 'border-accent bg-surface-2 text-ink'
                      : 'border-line text-ink-2 hover:text-ink'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="caption-language"
              label="Language code"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              hint="e.g. en, sn, nd"
              autoCapitalize="off"
            />
            <Field
              id="caption-label"
              label="Name in the player"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="English"
            />
          </div>
          <Segmented
            legend="Type"
            value={kind}
            options={[
              { value: 'subtitles', label: 'Subtitles' },
              { value: 'captions', label: 'Captions', note: 'with sounds' },
            ]}
            onChange={setKind}
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-5 w-5 accent-accent"
            />
            Turn on by default
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">WebVTT file</span>
            <label className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded border border-line bg-surface-2 px-4 text-sm font-semibold text-ink hover:bg-line focus-within:outline focus-within:outline-2 focus-within:outline-accent">
              <input
                type="file"
                accept=".vtt,text/vtt"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Icon name="upload" size={16} />
              {file ? 'Change file' : 'Choose .vtt file'}
            </label>
            <p className="num break-all text-xs text-ink-3">
              {file
                ? `${file.name} · ${Math.max(1, Math.round(file.size / 1000))} KB`
                : 'SRT files need converting to .vtt first.'}
            </p>
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          {success && <Notice tone="success">{success}</Notice>}

          <Button type="submit" loading={busy} disabled={!file} className="sm:w-fit">
            Add track
          </Button>
        </form>
      </section>
    </div>
  );
}
