'use client';
import { useState } from 'react';
import type { LiveStream } from '../../../src/types/api';
import { Icon } from '../../../src/ui/icon';

function Copyable({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-line bg-bg px-3 py-2 font-mono text-sm text-ink">
          {shown ? value : '•'.repeat(24)}
        </code>
        {secret && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            className="h-9 shrink-0 rounded px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2"
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2"
        >
          <Icon name={copied ? 'check' : 'share'} size={16} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * Where to point OBS (or a hardware encoder). The key is only known right after creating
 * the stream or resetting it; otherwise the creator resets it to see a new one.
 */
export function IngestSettings({ stream, streamKey }: { stream: LiveStream; streamKey?: string }) {
  const i = stream.ingest;
  return (
    <div className="flex flex-col gap-4">
      <Copyable label="Server (RTMP)" value={i.rtmp_url} />
      {streamKey ? (
        <>
          <Copyable
            label="Stream key"
            value={`${i.rtmp_stream_name}?user=key&pass=${streamKey}`}
            secret
          />
          <Copyable
            label="SRT (for unreliable mobile uplinks)"
            value={`${i.srt_url}:key:${streamKey}`}
            secret
          />
          <p className="text-xs text-ink-3">
            Save this key now: it isn&apos;t shown again. Anyone with it can stream as you; reset it
            if it leaks.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-3">
          The stream key is hidden. Reset it to get a new one (the old one stops working).
        </p>
      )}
      <details className="text-sm text-ink-2">
        <summary className="cursor-pointer font-semibold text-ink">
          Recommended encoder settings
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Video: H.264, keyframe interval 2 seconds, CBR.</li>
          <li>
            4K (2160p): 20–35 Mbps upload. 1080p: 6 Mbps. 720p: 3 Mbps. Viewers on phones still get
            240p–720p; we make those for you.
          </li>
          <li>Audio: AAC, 128–160 kbps, 48 kHz.</li>
          <li>On mobile data, prefer SRT: it recovers from dropped packets better than RTMP.</li>
        </ul>
      </details>
    </div>
  );
}
