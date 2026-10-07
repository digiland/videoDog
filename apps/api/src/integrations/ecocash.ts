import crypto, { randomUUID } from 'crypto';
import {
  minorToDecimalString,
  type ChargeParams,
  type ChargeResult,
  type PaymentRail,
  type ProviderStatus,
} from './rail';

/**
 * An empty HMAC key makes every webhook signature forgeable, so production refuses to boot
 * without one. Dev keeps the empty default so webhooks can be simulated locally.
 */
function requireWebhookSecret(): string {
  const secret = process.env.ECOCASH_WEBHOOK_SECRET ?? '';
  if (process.env.NODE_ENV === 'production' && secret.length < 16) {
    throw new Error('ECOCASH_WEBHOOK_SECRET must be set (16+ chars) in production');
  }
  return secret;
}

/**
 * EcoCash merchant API. USD and ZWG are separate merchant wallets with separate
 * credentials (CLAUDE.md §2), so each currency is its own client instance.
 *
 * NOTE: the endpoint paths below are placeholders until the EcoCash merchant API spec is
 * in hand; the request/response shapes are what the rest of the code relies on.
 * In non-production, no network calls are made: charges stay pending until a webhook (or
 * the dev simulate endpoint) settles them, and disbursements succeed immediately.
 */
export class EcocashClient implements PaymentRail {
  readonly currencies: readonly ('USD' | 'ZWG')[];
  private readonly base: string;
  private readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly dev: boolean;

  constructor(private readonly currency: 'USD' | 'ZWG') {
    const prefix = currency === 'USD' ? 'ECOCASH_USD' : 'ECOCASH_ZWG';
    this.currencies = [currency];
    this.base = process.env.ECOCASH_API_BASE ?? 'https://api.ecocash.co.zw';
    this.merchantCode = process.env[`${prefix}_MERCHANT_CODE`] ?? '';
    this.apiKey = process.env[`${prefix}_API_KEY`] ?? '';
    this.webhookSecret = requireWebhookSecret();
    this.dev = process.env.NODE_ENV !== 'production';
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    if (this.dev)
      return {
        provider_ref: `dev-${this.currency.toLowerCase()}-${randomUUID()}`,
        status: 'pending',
      };
    const data = await this.call<{ ref: string; status: string }>('POST', '/charges', {
      msisdn: params.msisdn,
      amount: minorToDecimalString(params.amountMinor),
      currency: this.currency,
      reference: params.reference,
      description: params.description ?? 'StreamZW',
    });
    return { provider_ref: data.ref, status: mapStatus(data.status) ?? 'pending' };
  }

  /** Provider's view of a charge, for reconciliation (§3.12). `null` = unknown (dev). */
  async getStatus(reference: string): Promise<ProviderStatus | null> {
    if (this.dev) return null;
    const data = await this.call<{ status: string }>(
      'GET',
      `/charges/${encodeURIComponent(reference)}`,
    );
    return mapStatus(data.status);
  }

  /** Send money to a wallet (creator payouts). Idempotent on `reference`. */
  async disburse(params: {
    msisdn: string;
    amountMinor: bigint;
    reference: string;
  }): Promise<ChargeResult> {
    if (this.dev) return { provider_ref: `dev-payout-${randomUUID()}`, status: 'completed' };
    const data = await this.call<{ ref: string; status: string }>('POST', '/disbursements', {
      msisdn: params.msisdn,
      amount: minorToDecimalString(params.amountMinor),
      currency: this.currency,
      reference: params.reference,
    });
    return { provider_ref: data.ref, status: mapStatus(data.status) ?? 'pending' };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const lane = this.currency.toLowerCase();
    const resp = await fetch(`${this.base}/${lane}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Merchant-Code': this.merchantCode,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok)
      throw new Error(`EcoCash ${this.currency} ${method} ${path} failed: ${resp.status}`);
    return (await resp.json()) as T;
  }
}

function mapStatus(s: string): ProviderStatus | null {
  const v = s.toUpperCase();
  if (v === 'COMPLETED' || v === 'SUCCESS' || v === 'SUCCESSFUL') return 'completed';
  if (v === 'FAILED' || v === 'CANCELLED' || v === 'EXPIRED' || v === 'DECLINED') return 'failed';
  if (v === 'PENDING' || v === 'PROCESSING' || v === 'INITIATED') return 'pending';
  return null;
}
