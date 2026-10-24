import type { ContentCategory } from '@streamzw/shared';

export interface User {
  id: string;
  phone_e164: string;
  handle: string | null;
  display_name: string | null;
  role: 'viewer' | 'creator' | 'admin';
  kyc_state: 'none' | 'phone_verified' | 'id_verified';
  preferred_display_currency: string;
  preferred_payout_currency: string | null;
  payout_msisdn: string | null;
  canonical_pricing_currency: string | null;
  created_at: string;
}

export type { ContentCategory };
export type AccessMode = 'free' | 'ppv' | 'premium' | 'premium_buyable';

export interface CreatorRef {
  id?: string;
  display_name: string | null;
  handle: string | null;
}

export interface LiveInfo {
  id: string;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  source_height: number | null;
  replay: boolean;
}

/** A creator's own stream, from /live/streams/*. */
export interface LiveStream {
  id: string;
  video_id: string;
  state: LiveInfo['state'];
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  record: boolean;
  recording_state: 'none' | 'pending' | 'ready' | 'failed';
  ingest: {
    connected: boolean;
    last_seen_at: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    codec: string | null;
    rtmp_url: string;
    rtmp_stream_name: string;
    srt_url: string;
  };
  video: Video | null;
  /** Only in the response that created the stream or reset its key. */
  stream_key?: string;
}

export interface Channel {
  id: string;
  handle: string | null;
  display_name: string | null;
  joined_at: string;
  video_count: number;
}

export interface CollectionSummary {
  id: string;
  owner_id: string;
  kind: 'course' | 'playlist';
  category: ContentCategory;
  title: string;
  description: string | null;
  state: 'draft' | 'published' | 'unpublished';
  published_at: string | null;
  created_at: string;
  video_count: number;
  duration_seconds: number;
  access_modes: Partial<Record<AccessMode, number>>;
  thumbnail_url: string | null;
  cover_video_id: string | null;
  creator: CreatorRef | null;
}

export interface CollectionEntry {
  id: string;
  section_id: string | null;
  position: number;
  video: Video;
}

export interface CollectionDetail extends CollectionSummary {
  sections: { id: string; title: string; position: number; items: CollectionEntry[] }[];
  unsectioned: CollectionEntry[];
}

export interface CollectionListResponse {
  items: CollectionSummary[];
  next_cursor: string | null;
}

export interface MoneyDTO {
  amount_minor: string;
  currency: string;
}

export interface Video {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  access_mode: AccessMode;
  category: ContentCategory;
  ppv_price_minor_units: string | null;
  ppv_price_currency: string | null;
  in_premium_pool: boolean;
  state: 'uploading' | 'processing' | 'ready' | 'published' | 'unpublished' | 'failed';
  duration_seconds: number | null;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  view_count?: number;
  published_at: string | null;
  created_at: string;
  creator?: CreatorRef | null;
  /** Set when the video is (or was) a live stream. */
  live?: LiveInfo | null;
  /** Watch history / purchases only. */
  watched_at?: string | null;
  purchased_at?: string | null;
  access_check_result?: AccessResult;
  comments_enabled?: boolean;
}

/** Matches AccessService's PlanQuote in the API. */
export interface PaywallPlanQuote {
  plan_id: string;
  code: string;
  /** What the subscription actually charges (plan base currency). */
  price: MoneyDTO;
  /** Render-only conversion to the viewer's display currency; absent without an FX rate. */
  display_price?: MoneyDTO;
}

export interface PaywallPayload {
  reasons: ('not_subscribed' | 'not_purchased')[];
  options: {
    buy?: { price: MoneyDTO; display_price?: MoneyDTO };
    subscribe?: { plans: PaywallPlanQuote[] };
  };
}

export type AccessResult = { ok: true } | { ok: false; paywall: PaywallPayload };

export interface VideoListResponse {
  items: Video[];
  next_cursor: string | null;
}

export interface SubscriptionPlan {
  id: string;
  code: string;
  duration_days: number;
  base_price: MoneyDTO;
  display_price: MoneyDTO;
}

export interface Subscription {
  id: string;
  state: 'active' | 'expired' | 'cancelled' | 'past_due' | 'none';
  expires_at: string | null;
  auto_renew: boolean;
  plan?: SubscriptionPlan;
}

export interface WalletBalance {
  balances: Array<{ currency: string; balance_minor: string }>;
}

export interface Earnings {
  ppv_amount: MoneyDTO;
  premium_pool_estimate: MoneyDTO;
  tips_amount: MoneyDTO;
  total: MoneyDTO;
  month: string;
}

export interface CaptionTrack {
  id: string;
  language: string;
  label: string;
  kind: 'subtitles' | 'captions';
  is_default?: boolean;
  url: string;
}

export interface PlayablePlaylist {
  /** Directly playable; embeds its own short-lived token (no auth header needed). */
  url: string;
  kind: 'hls' | 'progressive';
  expires_at: string;
  captions: CaptionTrack[];
  /** A live stream on air (the URL is the live origin). */
  live?: boolean;
}

/** A live stream the viewer may watch that hasn't started yet. */
export interface PlaylistUpcoming {
  upcoming: true;
  scheduled_at: string | null;
}

export interface PlaylistDenied {
  access_denied: true;
  paywall: PaywallPayload;
}

export type PlaylistResponse = PlayablePlaylist | PlaylistDenied | PlaylistUpcoming;

export type PaymentCurrencyCode = 'USD' | 'ZWG' | 'ZAR';

export interface CreatePurchaseResponse {
  purchase_id: string;
  paid_amount: MoneyDTO;
  usd_equivalent: MoneyDTO;
}

export interface CreateSubscriptionResponse {
  subscription_id: string;
  charged_amount: MoneyDTO;
  usd_equivalent: MoneyDTO;
  expires_at: string;
}

export interface CreatePaymentResponse {
  payment_id: string;
  provider_ref: string | null;
  status: PaymentState;
  /** Card (Paystack) payments: send the browser here to pay. Absent on idempotent replays. */
  redirect_url?: string;
}

export type PaymentState = 'initiated' | 'pending' | 'completed' | 'failed' | 'reversed';

export interface PaymentStatus {
  id: string;
  state: PaymentState;
  intent: 'purchase' | 'subscription' | 'tip';
  intent_ref_id: string | null;
  amount: MoneyDTO;
}
