import crypto, { randomUUID } from 'crypto';
import type { ChargeParams, ChargeResult, PaymentRail, ProviderStatus } from './rail';

/**
 * Paystack card checkout — the diaspora rail (ZAR, USD). Hosted checkout: we initialise a
 * transaction, the viewer pays on Paystack's page, Paystack calls our webhook.
 *
 * API: POST /transaction/initialize, GET /transaction/verify/:reference; webhooks are signed
 * with HMAC-SHA512 of the raw body using the secret key (header `x-paystack-signature`).
 * Which currencies a merchant may charge depends on the Paystack account.
 */
export class PaystackClient implements PaymentRail {
  readonly currencies = ['ZAR', 'USD'] as const;
  private readonly base = 'https://api.paystack.co';
  private readonly secretKey: string;
  private readonly callbackUrl: string | undefined;
  private readonly dev: boolean;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY ?? '';
    this.callbackUrl = process.env.PAYSTACK_CALLBACK_URL || undefined;
    this.dev = process.env.NODE_ENV !== 'production';
    if (!this.dev && this.secretKey.length < 16) {
      throw new Error('PAYSTACK_SECRET_KEY must be set in production');
    }
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    if (this.dev && !this.secretKey) {
      return {
        provider_ref: `dev-paystack-${randomUUID()}`,
        status: 'pending',
        redirect_url: `${this.callbackUrl ?? 'http://localhost:3000/checkout/return'}?reference=${params.reference}`,
      };
    }
    const data = await this.call<{ data: { authorization_url: string; reference: string } }>(
      'POST',
      '/transaction/initialize',
      {
        email: params.email,
        amount: params.amountMinor.toString(), // subunits, as a string: no float
        currency: params.currency,
        reference: params.reference,
        callback_url: this.callbackUrl,
        metadata: { msisdn: params.msisdn },
      },
    );
    return {
      provider_ref: data.data.reference,
      status: 'pending',
      redirect_url: data.data.authorization_url,
    };
  }

  async getStatus(reference: string): Promise<ProviderStatus | null> {
    const v = await this.verify(reference);
    return v?.status ?? null;
  }

  /** Paystack's record of a transaction, including amount and currency to check against ours. */
  async verify(
    reference: string,
  ): Promise<{ status: ProviderStatus; amountMinor: bigint; currency: string } | null> {
    if (this.dev && !this.secretKey) return null;
    const res = await this.call<{ data: { status: string; amount: number; currency: string } }>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    const s = res.data.status;
    const status: ProviderStatus =
      s === 'success' ? 'completed' : s === 'failed' || s === 'reversed' ? 'failed' : 'pending';
    return { status, amountMinor: BigInt(res.data.amount), currency: res.data.currency };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.secretKey) return false;
    const expected = crypto.createHmac('sha512', this.secretKey).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`Paystack ${method} ${path} failed: ${resp.status}`);
    return (await resp.json()) as T;
  }
}
