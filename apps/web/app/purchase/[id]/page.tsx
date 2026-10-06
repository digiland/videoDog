'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import type { MoneyDTO, PaywallPlanQuote, Video } from '../../../src/types/api';
import { LinkButton } from '../../../src/ui/button';
import { DataCost } from '../../../src/ui/data-cost';
import { Icon } from '../../../src/ui/icon';
import { Price } from '../../../src/ui/price';
import { EmptyState, Skeleton } from '../../../src/ui/state';
import Checkout from '../../components/Checkout';
import { errorText } from '../../components/account/errors';

type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready';
      video: Video;
      price: MoneyDTO | null;
      local: MoneyDTO | null;
      plans: PaywallPlanQuote[];
      hasAccess: boolean;
    }
  | { status: 'error'; message: string };

/** Price to show before checkout: the paywall's buy option, else the video's PPV price. */
function listPrice(video: Video): MoneyDTO | null {
  const access = video.access_check_result;
  if (access && !access.ok && access.paywall.options.buy) {
    return access.paywall.options.buy.price;
  }
  if (video.ppv_price_minor_units && video.ppv_price_currency) {
    return {
      amount_minor: String(video.ppv_price_minor_units),
      currency: video.ppv_price_currency,
    };
  }
  return null;
}

/** Render-only approximation in the viewer's display currency, when the API gave one. */
function localPrice(video: Video): MoneyDTO | null {
  const access = video.access_check_result;
  return access && !access.ok ? (access.paywall.options.buy?.display_price ?? null) : null;
}

function cheapestPlan(plans: PaywallPlanQuote[]): PaywallPlanQuote | null {
  return plans.reduce<PaywallPlanQuote | null>(
    (min, p) =>
      !min ||
      (p.price.currency === min.price.currency &&
        BigInt(p.price.amount_minor) < BigInt(min.price.amount_minor))
        ? p
        : min,
    null,
  );
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
        const access = video.access_check_result;
        setState({
          status: 'ready',
          video,
          price: listPrice(video),
          local: localPrice(video),
          plans: access && !access.ok ? (access.paywall.options.subscribe?.plans ?? []) : [],
          hasAccess: access?.ok === true,
        });
      } catch (err: unknown) {
        if (!cancelled) {
          setState({ status: 'error', message: errorText(err, 'This video is unavailable.') });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const videoHref = `/v/${encodeURIComponent(id)}`;

  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-10 flex flex-col gap-4">
      <Link
        href={videoHref}
        className="inline-flex items-center gap-1 -ml-1 h-11 self-start text-sm font-semibold text-ink-2 hover:text-ink"
      >
        <Icon name="chevronLeft" size={18} />
        Back to video
      </Link>
      <h1 className="text-2xl font-bold text-ink">Unlock video</h1>

      {state.status === 'loading' && (
        <div className="flex flex-col gap-5" aria-busy>
          <div className="flex gap-3 pb-4 border-b border-line">
            <Skeleton className="w-24 aspect-video rounded-md" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-full" />
            </div>
          </div>
          <Skeleton className="h-[100px]" />
          <Skeleton className="h-12" />
        </div>
      )}

      {state.status === 'error' && (
        <EmptyState
          title="This video is unavailable"
          action={
            <LinkButton href="/" variant="secondary">
              Browse videos
            </LinkButton>
          }
        >
          {state.message}
        </EmptyState>
      )}

      {state.status === 'ready' &&
        (state.hasAccess ? (
          <EmptyState
            title="You already have this video"
            action={
              <LinkButton href={videoHref} icon="play" size="lg">
                Watch now
              </LinkButton>
            }
          >
            {state.video.title}
          </EmptyState>
        ) : state.price === null ? (
          <EmptyState
            title="This video can't be bought on its own"
            action={
              <LinkButton href={`/pricing?return_to=${encodeURIComponent(videoHref)}`} size="lg">
                See Premium plans
              </LinkButton>
            }
          >
            It&rsquo;s included with Premium.
          </EmptyState>
        ) : (
          <>
            <Checkout
              target={{ kind: 'purchase', videoId: id }}
              item={{
                caption: 'Pay once, watch any time',
                title: state.video.title,
                thumbnailUrl: state.video.thumbnail_url,
                meta: <DataCost seconds={state.video.duration_seconds} />,
              }}
              returnPath={videoHref}
              listPrice={state.price}
              quotes={state.local ? [state.local] : undefined}
              initialCurrency={state.price.currency}
              onCompleted={() => router.replace(videoHref)}
            />
            <PremiumAlternative plans={state.plans} videoHref={videoHref} />
          </>
        ))}
    </div>
  );
}

/** For premium_buyable videos: the subscription is the other way in, so say so once. */
function PremiumAlternative({
  plans,
  videoHref,
}: {
  plans: PaywallPlanQuote[];
  videoHref: string;
}) {
  const plan = cheapestPlan(plans);
  if (!plan) return null;
  return (
    <Link
      href={`/pricing?return_to=${encodeURIComponent(videoHref)}`}
      className="flex items-center gap-3 rounded border border-line px-4 py-3 text-sm hover:bg-surface"
    >
      <span className="flex-1 text-ink-2">
        <span className="font-semibold text-gold">Included with Premium.</span> Watch this and every
        Premium video from <Price money={plan.price} className="font-semibold text-ink" />.
      </span>
      <Icon name="chevronRight" size={18} className="text-ink-3 shrink-0" />
    </Link>
  );
}
