'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import type { MoneyDTO, Video } from '../../../src/types/api';
import Checkout from '../../components/Checkout';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; video: Video; price: MoneyDTO | null; hasAccess: boolean }
  | { status: 'error'; message: string };

/** Price to show before checkout: the paywall's buy option, else the video's PPV price. */
function listPrice(video: Video): MoneyDTO | null {
  const access = video.access_check_result;
  if (access && !access.ok && access.paywall.options.buy) {
    return access.paywall.options.buy.price;
  }
  if (video.ppv_price_minor_units && video.ppv_price_currency) {
    return { amount_minor: video.ppv_price_minor_units, currency: video.ppv_price_currency };
  }
  return null;
}

export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const video = await api.get<Video>(`/videos/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setState({
          status: 'ready',
          video,
          price: listPrice(video),
          hasAccess: video.access_check_result?.ok === true,
        });
      } catch (err: unknown) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Video unavailable',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-10 fade-up">
      <Link href={`/v/${id}`} className="text-sm text-ink-mute hover:text-ink">
        ← Back to video
      </Link>
      <h1 className="text-2xl font-bold mt-3">Unlock video</h1>

      <div className="mt-6 bg-bg-elev border border-line rounded-lg p-6">
        {state.status === 'loading' && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {state.status === 'error' && <p className="text-sm text-ink-mute">Video unavailable.</p>}

        {state.status === 'ready' && (
          <>
            <p className="text-sm text-ink-dim uppercase tracking-wide">One-time unlock</p>
            <p className="text-lg font-semibold mt-1 mb-5 break-words">{state.video.title}</p>

            {state.hasAccess ? (
              <div className="space-y-4">
                <p className="text-sm text-ok">You already have access to this video.</p>
                <Link
                  href={`/v/${id}`}
                  className="block text-center w-full bg-accent hover:bg-accent-hot text-bg font-semibold py-3 rounded-md text-sm transition"
                >
                  Watch now
                </Link>
              </div>
            ) : state.price === null ? (
              <p className="text-sm text-ink-mute">
                This video can&rsquo;t be bought individually.
              </p>
            ) : (
              <Checkout
                target={{ kind: 'purchase', videoId: id }}
                returnPath={`/v/${id}`}
                listPrice={state.price}
                initialCurrency={state.price.currency}
                onCompleted={() => router.replace(`/v/${id}`)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
