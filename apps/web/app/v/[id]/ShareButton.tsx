'use client';
import { useState } from 'react';
import { Icon } from '../../../src/ui/icon';

/**
 * Share: the phone's share sheet where there is one (WhatsApp is one tap away), else a
 * WhatsApp link plus copy. WhatsApp is how videos spread (VISION.md).
 */
export default function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function share() {
    const url = window.location.href.replace(/#.*$/, '');
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // cancelled: fall through to the menu
      }
    }
    setOpen((o) => !o);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: nothing else to do
    }
  }

  const pill =
    'inline-flex h-9 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold text-ink transition-colors hover:bg-line';
  return (
    <div className="relative">
      <button type="button" onClick={() => void share()} className={pill} aria-expanded={open}>
        <Icon name="share" size={18} />
        Share
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 flex w-56 flex-col rounded-lg border border-line bg-surface py-2 text-sm">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${title} ${typeof window === 'undefined' ? '' : window.location.href}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-ink hover:bg-surface-2"
          >
            Share on WhatsApp
          </a>
          <button
            type="button"
            onClick={() => void copy()}
            className="px-4 py-2 text-left text-ink hover:bg-surface-2"
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}
