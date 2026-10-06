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

export interface MoneyDTO {
  amount_minor: string;
  currency: string;
}

export interface Video {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  access_mode: 'free' | 'ppv' | 'premium' | 'premium_buyable';
  ppv_price_minor_units: string | null;
  ppv_price_currency: string | null;
  in_premium_pool: boolean;
  state: 'uploading' | 'processing' | 'ready' | 'published' | 'unpublished' | 'failed';
  duration_seconds: number | null;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  created_at: string;
  creator?: { display_name: string | null; handle: string | null };
  access_check_result?: AccessResult;
  comments_enabled?: boolean;
}

export interface PaywallPlanQuote {
  id: string;
  code: string;
  duration_days: number;
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
  balances: Array<{ currency: string; amount_minor: string }>;
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
}

export interface PlaylistDenied {
  access_denied: true;
  paywall: PaywallPayload;
}

export type PlaylistResponse = PlayablePlaylist | PlaylistDenied;

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
}

export type PaymentState = 'initiated' | 'pending' | 'completed' | 'failed' | 'reversed';

export interface PaymentStatus {
  id: string;
  state: PaymentState;
  intent: 'purchase' | 'subscription' | 'tip';
  intent_ref_id: string | null;
  amount: MoneyDTO;
}
