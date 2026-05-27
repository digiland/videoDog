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
  hls_playlist_key: string | null;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  created_at: string;
  creator?: { display_name: string | null; handle: string | null };
  access_check_result?: AccessResult;
  comments_enabled?: boolean;
}

export interface PaywallPayload {
  reasons: ('not_subscribed' | 'not_purchased')[];
  options: {
    buy?: { price: MoneyDTO };
    subscribe?: {
      plans: Array<{
        id: string;
        code: string;
        duration_days: number;
        display_price: MoneyDTO;
      }>;
    };
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

export interface PlaylistResponse {
  url: string;
}
