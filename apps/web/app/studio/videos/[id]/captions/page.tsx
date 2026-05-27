'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../../src/lib/api';
import { isAuthenticated } from '../../../../../src/lib/auth';

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
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const [items, setItems] = useState<Caption[] | null>(null);
  const [language, setLanguage] = useState('en');
  const [label, setLabel] = useState('English');
  const [kind, setKind] = useState<'subtitles' | 'captions'>('subtitles');
  const [isDefault, setIsDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    void load();
  }, [videoId, router]);

  async function load() {
    try {
      const data = await api.get<{ items: Caption[] }>(`/videos/${videoId}/captions`);
      setItems(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a .vtt file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<{ caption_id: string; upload_url: string }>(
        `/videos/${videoId}/captions`,
        { language, label, kind, is_default: isDefault },
      );
      const put = await fetch(created.upload_url, {
        method: 'PUT',
        headers: { 'content-type': 'text/vtt' },
        body: file,
      });
      if (!put.ok) throw new Error('Upload failed');
      await api.post(`/videos/${videoId}/captions/${created.caption_id}/complete`);
      setSuccess(`Uploaded "${label}".`);
      setFile(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this caption track?')) return;
    try {
      await api.delete(`/videos/${videoId}/captions/${id}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 fade-up">
      <div className="flex items-center gap-2 text-sm text-ink-mute mb-2">
        <Link href="/studio" className="hover:text-ink">
          Studio
        </Link>
        <span>/</span>
        <Link href="/studio/videos" className="hover:text-ink">
          Videos
        </Link>
        <span>/</span>
        <span className="text-ink">Captions</span>
      </div>
      <h1 className="text-3xl font-bold">Closed captions</h1>
      <p className="text-ink-mute mt-1 max-w-xl">
        Upload one WebVTT file per language. Viewers can switch tracks from the player&rsquo;s CC
        menu. SRT not supported — convert to .vtt first.
      </p>

      {/* Existing tracks */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim mb-3">Tracks</h2>
        <div className="space-y-2">
          {items === null ? (
            <div className="bg-bg-elev border border-line rounded-lg p-6 text-center text-ink-dim text-sm">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="bg-bg-elev border border-line rounded-lg p-6 text-center text-ink-mute text-sm">
              No caption tracks yet. Upload your first below.
            </div>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className="bg-bg-elev border border-line rounded-lg p-4 flex items-center gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-xs text-ink-dim font-mono">{c.language}</span>
                    {c.is_default && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-accent/15 text-accent px-2 py-0.5 rounded">
                        Default
                      </span>
                    )}
                    {!c.ready && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-warn/15 text-warn px-2 py-0.5 rounded">
                        Uploading…
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-dim mt-0.5 capitalize">{c.kind}</p>
                </div>
                <button
                  onClick={() => void handleDelete(c.id)}
                  className="text-sm text-ink-dim hover:text-red-400 transition"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Upload form */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim mb-3">
          Add a track
        </h2>
        <form
          onSubmit={(e) => void handleUpload(e)}
          className="bg-bg-elev border border-line rounded-lg p-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Language</label>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => {
                      setLanguage(s.code);
                      setLabel(s.label);
                    }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${
                      language === s.code
                        ? 'bg-accent text-bg'
                        : 'bg-surface text-ink-mute hover:text-ink'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="BCP-47 code (e.g. en, sn, nd)"
                className="mt-2 w-full bg-surface border border-line focus:border-accent rounded-md px-3 py-2 text-sm focus:outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Label (shown in player)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="English"
                className="w-full bg-surface border border-line focus:border-accent rounded-md px-3 py-2 text-sm focus:outline-none transition"
              />
              <div className="mt-3 flex items-center gap-3">
                <label className="text-sm flex items-center gap-2">
                  <input
                    type="radio"
                    checked={kind === 'subtitles'}
                    onChange={() => setKind('subtitles')}
                    className="accent-accent"
                  />
                  Subtitles
                </label>
                <label className="text-sm flex items-center gap-2">
                  <input
                    type="radio"
                    checked={kind === 'captions'}
                    onChange={() => setKind('captions')}
                    className="accent-accent"
                  />
                  Captions (incl. sound effects)
                </label>
              </div>
              <label className="mt-2 text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="accent-accent"
                />
                Show by default
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">WebVTT file</label>
            <input
              type="file"
              accept=".vtt,text/vtt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-ink-mute file:bg-surface file:text-ink file:border-0 file:rounded file:px-3 file:py-1.5 file:mr-3 file:cursor-pointer file:hover:bg-surface-2"
            />
            <p className="mt-1 text-xs text-ink-dim">
              {file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'No file selected.'}
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-ok/10 border border-ok/30 text-ok rounded-md px-4 py-3 text-sm">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !file}
            className="bg-accent hover:bg-accent-hot text-bg font-semibold py-2.5 px-5 rounded-md text-sm transition disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload track'}
          </button>
        </form>
      </section>
    </div>
  );
}
