'use client';
import { useEffect, useId, useState } from 'react';
import { api } from '../../../src/lib/api';
import { minorToJsonNumber } from '../../../src/lib/money-input';
import {
  formatEta,
  formatMB,
  percent,
  titleFromFileName,
  type ResumeRecord,
  type UploadDraft,
} from '../../../src/lib/upload';
import { Button, LinkButton } from '../../../src/ui/button';
import { Field } from '../../../src/ui/field';
import { Icon, type IconName } from '../../../src/ui/icon';
import { Notice } from '../../../src/ui/notice';
import { AccessModePicker } from '../_components/AccessModePicker';
import {
  type AccessMode,
  errorMessage,
  fetchMe,
  needsPrice,
  parsePpvPrice,
} from '../_components/studio-data';
import { PageTitle } from '../_components/ui';
import {
  clearResumeRecord,
  readResumeRecord,
  useResumableUpload,
  type UploadView,
} from '../_components/use-resumable-upload';

const EMPTY_DRAFT: UploadDraft = { title: '', description: '', access_mode: 'free', price: '' };

export default function UploadPage() {
  const up = useResumableUpload();
  const { view } = up;
  const [currency, setCurrency] = useState('USD');
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState<ResumeRecord | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [autoPublish, setAutoPublish] = useState(false);

  useEffect(() => {
    fetchMe()
      .then((me) => setCurrency(me.canonical_pricing_currency ?? 'USD'))
      .catch(() => undefined);
    const rec = readResumeRecord();
    if (rec) {
      setPending(rec);
      if (rec.draft) setDraft(rec.draft);
    }
  }, []);

  const { saveDraft, publish } = up;
  useEffect(() => {
    saveDraft(draft);
  }, [draft, saveDraft]);

  const set = <K extends keyof UploadDraft>(k: K, v: UploadDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaveNote(null);
    if (k === 'price' || k === 'access_mode') setPriceError(null);
    if (k === 'title') setTitleError(null);
  };

  function pickNew(file: File) {
    setPickError(null);
    const d = { ...draft, title: draft.title.trim() || titleFromFileName(file.name) };
    setDraft(d);
    // Bytes start moving now; details are saved with Publish (or Save draft) while it uploads.
    void up.start(file, { title: d.title.trim().slice(0, 255), access_mode: 'free' }, d);
  }

  async function pickResume(rec: ResumeRecord, file: File) {
    setPickError(null);
    const err = await up.resumeFrom(rec, file);
    if (err) setPickError(err);
    else setPending(null);
  }

  async function discardPending() {
    if (!pending) return;
    clearResumeRecord();
    const rec = pending;
    setPending(null);
    setDraft(EMPTY_DRAFT);
    await api
      .post(`/videos/${rec.video_id}/upload/multipart/${encodeURIComponent(rec.upload_id)}/abort`)
      .catch(() => undefined);
  }

  /** PATCH the typed details. Returns false (with the error shown) if they don't validate. */
  async function saveDetails(): Promise<boolean> {
    const id = view.videoId;
    if (!id) return false;
    const title = draft.title.trim();
    if (!title) {
      setTitleError('Give the video a title.');
      return false;
    }
    const body: Record<string, unknown> = {
      title: title.slice(0, 255),
      description: draft.description.trim(),
      access_mode: draft.access_mode,
      ppv_price_minor_units: null,
      ppv_price_currency: null,
    };
    if (needsPrice(draft.access_mode)) {
      const p = parsePpvPrice(draft.price, currency);
      if (!p.ok) {
        setPriceError(p.error);
        return false;
      }
      // JSON number only at the API boundary; PPV prices are ≤ 200 minor units.
      body.ppv_price_minor_units = minorToJsonNumber(p.minor);
      body.ppv_price_currency = currency;
    }
    setSaving(true);
    try {
      await api.patch(`/videos/${id}`, body);
      return true;
    } catch (err) {
      setSaveNote({ tone: 'error', text: `Details not saved: ${errorMessage(err, 'try again')}.` });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    setSaveNote(null);
    if (!(await saveDetails())) return;
    if (view.phase === 'ready') await publish();
    else setAutoPublish(true);
  }

  async function onSaveDraft() {
    setSaveNote(null);
    if (await saveDetails()) {
      setSaveNote({
        tone: 'success',
        text: 'Details saved. You can publish from here or later from Videos.',
      });
    }
  }

  // Publish the moment processing finishes, if the creator asked for it.
  useEffect(() => {
    if (autoPublish && view.phase === 'ready') {
      setAutoPublish(false);
      void publish();
    }
  }, [autoPublish, view.phase, publish]);

  function startOver() {
    up.reset();
    setDraft(EMPTY_DRAFT);
    setAutoPublish(false);
    setSaveNote(null);
  }

  const showForm = view.phase !== 'published' && view.phase !== 'failed';
  const idle = view.phase === 'idle';

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <PageTitle title="Upload">
        Uploads keep going through dropped connections. Fill in the details while it uploads.
      </PageTitle>

      {idle && pending ? (
        <ResumeCard
          rec={pending}
          error={pickError}
          onPick={(f) => void pickResume(pending, f)}
          onDiscard={() => void discardPending()}
        />
      ) : idle ? (
        <FilePicker onPick={pickNew} error={pickError} />
      ) : (
        <ProgressCard
          view={view}
          autoPublish={autoPublish}
          onPause={up.pause}
          onResume={() => void up.resume()}
          onCancel={() => {
            void up.cancel();
            setDraft(EMPTY_DRAFT);
            setAutoPublish(false);
          }}
          onStartOver={startOver}
        />
      )}

      {showForm && (
        <section
          aria-labelledby="details-h"
          className="flex flex-col gap-5 rounded border border-line bg-surface p-4 sm:p-5"
        >
          <h2 id="details-h" className="text-base font-semibold text-ink">
            Details
          </h2>
          <Field
            id="upload-title"
            label="Title"
            value={draft.title}
            maxLength={255}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Comedy night at Reps Theatre"
            error={titleError}
          />
          <TextArea
            label="Description"
            value={draft.description}
            onChange={(v) => set('description', v)}
            hint="Optional. Who's in it, where, what to expect."
          />
          <AccessModePicker
            idPrefix="upload"
            mode={draft.access_mode}
            onMode={(m: AccessMode) => set('access_mode', m)}
            price={draft.price}
            onPrice={(p) => set('price', p)}
            currency={currency}
            error={priceError}
          />

          {!idle && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              {saveNote && <Notice tone={saveNote.tone}>{saveNote.text}</Notice>}
              {view.message && view.phase === 'ready' && (
                <Notice tone="error">{view.message}</Notice>
              )}
              {autoPublish ? (
                <Notice
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setAutoPublish(false)}>
                      Don&rsquo;t
                    </Button>
                  }
                >
                  Will publish as soon as it&rsquo;s ready. Keep this page open.
                </Notice>
              ) : (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => void onSaveDraft()}
                    disabled={saving || view.phase === 'starting' || view.phase === 'publishing'}
                  >
                    Save draft
                  </Button>
                  <Button
                    size="lg"
                    icon="check"
                    onClick={() => void onPublish()}
                    loading={saving || view.phase === 'publishing'}
                    disabled={view.phase === 'starting'}
                    className="sm:min-w-48"
                  >
                    {view.phase === 'ready' || view.phase === 'publishing'
                      ? 'Publish'
                      : 'Publish when ready'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={5000}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="rounded border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-3 outline-none focus:border-accent resize-y"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}

function FilePicker({ onPick, error }: { onPick: (f: File) => void; error: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="group flex flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-line bg-surface px-4 py-10 text-center cursor-pointer transition-colors hover:border-accent focus-within:border-accent">
        <input
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onPick(f);
          }}
        />
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent">
          <Icon name="upload" size={24} />
        </span>
        <span className="text-base font-semibold text-ink">Choose a video</span>
        <span className="text-sm text-ink-3 max-w-xs">
          MP4 or MOV from your phone or camera. Uploading starts straight away.
        </span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <Icon name="data" size={14} />
        Uploading uses data equal to the file size. Wi-Fi saves your bundle.
      </p>
    </div>
  );
}

function ResumeCard({
  rec,
  error,
  onPick,
  onDiscard,
}: {
  rec: ResumeRecord;
  error: string | null;
  onPick: (f: File) => void;
  onDiscard: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded border border-accent bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon name="pause" size={20} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Finish your upload</h2>
          <p className="mt-1 text-sm text-ink-2 break-words">
            <span className="font-semibold text-ink">{rec.file.name}</span> ·{' '}
            <span className="num">{formatMB(rec.file.size)}</span>. Pick the same file and it
            carries on from where it stopped — parts already sent aren&rsquo;t sent again.
          </p>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative inline-flex h-12 items-center justify-center gap-2 rounded bg-accent px-5 text-base font-semibold text-on-accent cursor-pointer hover:bg-accent-strong focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPick(f);
            }}
          />
          <Icon name="upload" size={18} />
          Pick file to resume
        </label>
        <Button variant="ghost" size="lg" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </section>
  );
}

const STATUS: Record<
  UploadView['phase'],
  { label: string; icon: IconName; tone: string; bar: string }
> = {
  idle: { label: '', icon: 'upload', tone: 'text-ink', bar: 'bg-accent' },
  starting: { label: 'Starting', icon: 'spinner', tone: 'text-ink', bar: 'bg-accent' },
  uploading: { label: 'Uploading', icon: 'upload', tone: 'text-ink', bar: 'bg-accent' },
  paused: { label: 'Paused', icon: 'pause', tone: 'text-gold', bar: 'bg-ink-3' },
  finishing: { label: 'Finishing upload', icon: 'spinner', tone: 'text-ink', bar: 'bg-accent' },
  processing: { label: 'Processing', icon: 'spinner', tone: 'text-ink', bar: 'bg-sage' },
  ready: { label: 'Ready to publish', icon: 'check', tone: 'text-sage', bar: 'bg-sage' },
  publishing: { label: 'Publishing', icon: 'spinner', tone: 'text-ink', bar: 'bg-sage' },
  published: { label: 'Published', icon: 'check', tone: 'text-sage', bar: 'bg-sage' },
  failed: { label: 'Failed', icon: 'alert', tone: 'text-danger', bar: 'bg-danger' },
};

function ProgressCard({
  view,
  autoPublish,
  onPause,
  onResume,
  onCancel,
  onStartOver,
}: {
  view: UploadView;
  autoPublish: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onStartOver: () => void;
}) {
  const s = STATUS[view.phase];
  const uploaded = ['processing', 'ready', 'publishing', 'published'].includes(view.phase);
  const sent = uploaded ? view.totalBytes : view.sentBytes;
  const pct = percent(sent, view.totalBytes);
  const label =
    view.phase === 'paused'
      ? view.pauseReason === 'offline'
        ? 'Paused (offline)'
        : view.pauseReason === 'user'
          ? 'Paused'
          : 'Paused (connection problem)'
      : s.label;
  const canCancel = ['starting', 'uploading', 'paused'].includes(view.phase);

  return (
    <section
      aria-label="Upload progress"
      className="flex flex-col gap-3 rounded border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 text-base font-semibold ${s.tone}`}>
            <Icon name={s.icon} size={18} className="shrink-0" />
            <output>{label}</output>
          </p>
          <p className="mt-0.5 truncate text-sm text-ink-3">{view.fileName}</p>
        </div>
        {view.phase !== 'failed' && (
          <span className="num text-2xl font-bold leading-none text-ink">{pct}%</span>
        )}
      </div>

      {view.phase !== 'failed' && (
        <div aria-hidden className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-[width] ${s.bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {view.phase !== 'failed' && (
        <p className="num flex flex-wrap gap-x-2 text-sm text-ink-2">
          <span>
            {formatMB(sent)} of {formatMB(view.totalBytes)}
          </span>
          {view.phase === 'uploading' && view.partCount > 0 && (
            <span className="text-ink-3">
              · part {Math.min(view.partsDone + 1, view.partCount)} of {view.partCount}
            </span>
          )}
          {view.phase === 'uploading' && view.etaSeconds !== null && (
            <span className="text-ink-3">· {formatEta(view.etaSeconds)}</span>
          )}
        </p>
      )}

      {view.phase === 'uploading' && view.retrying && (
        <p className="text-sm text-gold">
          Part {view.retrying.part} didn&rsquo;t go through — trying again
          {view.retrying.inSeconds > 0 ? ` in ${view.retrying.inSeconds}s` : ''} (try{' '}
          {view.retrying.attempt} of 3).
        </p>
      )}

      {view.phase === 'paused' && view.pauseReason === 'offline' && (
        <p className="text-sm text-ink-2">
          You&rsquo;re offline. It carries on by itself when you&rsquo;re back online — parts
          already sent are kept.
        </p>
      )}
      {view.phase === 'paused' && view.message && <Notice tone="warning">{view.message}</Notice>}

      {view.phase === 'processing' && (
        <p className="text-sm text-ink-2">
          Upload complete. We&rsquo;re making 240p, 480p and 720p versions so it plays on any bundle
          — usually a few minutes.{' '}
          {autoPublish ? '' : 'You can leave this page; it will be in Videos.'}
        </p>
      )}
      {view.phase === 'ready' && (
        <p className="text-sm text-ink-2">Check the details below, then publish.</p>
      )}
      {view.phase === 'failed' && view.message && <Notice tone="error">{view.message}</Notice>}

      {view.phase === 'published' && view.videoId && (
        <PublishedActions videoId={view.videoId} onAnother={onStartOver} />
      )}

      {(canCancel || view.phase === 'failed') && (
        <div className="flex flex-wrap gap-2">
          {view.phase === 'uploading' && (
            <Button variant="secondary" icon="pause" onClick={onPause}>
              Pause
            </Button>
          )}
          {view.phase === 'paused' && (
            <Button variant="secondary" icon="play" onClick={onResume}>
              Resume
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel upload
            </Button>
          )}
          {view.phase === 'failed' && (
            <Button variant="secondary" icon="upload" onClick={onStartOver}>
              Upload a different file
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PublishedActions({ videoId, onAnother }: { videoId: string; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}/v/${videoId}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // share sheet dismissed
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">It&rsquo;s live. Share it where your fans are.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Share link'}
        </Button>
        <LinkButton href={`/v/${videoId}`} variant="secondary" size="lg">
          View video
        </LinkButton>
        <Button variant="ghost" size="lg" icon="upload" onClick={onAnother}>
          Upload another
        </Button>
      </div>
    </div>
  );
}
