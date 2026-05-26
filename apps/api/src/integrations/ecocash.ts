import crypto from 'crypto';
import { randomUUID } from 'crypto';

export interface ChargeParams {
  msisdn: string; // E.164 payer phone
  amountMinor: bigint;
  currency: 'USD' | 'ZWG';
  reference: string; // idempotency_key
  description?: string;
}

export interface ChargeResult {
  provider_ref: string;
  status: 'pending' | 'completed' | 'failed';
}

export class EcocashUsdClient {
  private readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly dev: boolean;

  constructor() {
    this.merchantCode = process.env.ECOCASH_USD_MERCHANT_CODE ?? '';
    this.apiKey = process.env.ECOCASH_USD_API_KEY ?? '';
    this.webhookSecret = process.env.ECOCASH_WEBHOOK_SECRET ?? '';
    this.dev = process.env.NODE_ENV !== 'production';
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    if (this.dev) {
      return { provider_ref: `dev-usd-${randomUUID()}`, status: 'pending' };
    }
    // Production: call EcoCash USD API
    const resp = await fetch('https://api.ecocash.co.zw/usd/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Merchant-Code': this.merchantCode,
      },
      body: JSON.stringify({
        msisdn: params.msisdn,
        amount: Number(params.amountMinor) / 100,
        currency: params.currency,
        reference: params.reference,
        description: params.description ?? 'StreamZW',
      }),
    });
    if (!resp.ok) throw new Error(`EcoCash USD charge failed: ${resp.status}`);
    const data = (await resp.json()) as { ref: string; status: string };
    return {
      provider_ref: data.ref,
      status: data.status === 'COMPLETED' ? 'completed' : 'pending',
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }
}

export class EcocashZwgClient {
  private readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly dev: boolean;

  constructor() {
    this.merchantCode = process.env.ECOCASH_ZWG_MERCHANT_CODE ?? '';
    this.apiKey = process.env.ECOCASH_ZWG_API_KEY ?? '';
    this.webhookSecret = process.env.ECOCASH_WEBHOOK_SECRET ?? '';
    this.dev = process.env.NODE_ENV !== 'production';
  }

  async createCharge(params: ChargeParams): Promise<ChargeResult> {
    if (this.dev) {
      return { provider_ref: `dev-zwg-${randomUUID()}`, status: 'pending' };
    }
    // Production: call EcoCash ZWG API
    const resp = await fetch('https://api.ecocash.co.zw/zwg/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Merchant-Code': this.merchantCode,
      },
      body: JSON.stringify({
        msisdn: params.msisdn,
        amount: Number(params.amountMinor) / 100,
        currency: 'ZWG',
        reference: params.reference,
        description: params.description ?? 'StreamZW',
      }),
    });
    if (!resp.ok) throw new Error(`EcoCash ZWG charge failed: ${resp.status}`);
    const data = (await resp.json()) as { ref: string; status: string };
    return {
      provider_ref: data.ref,
      status: data.status === 'COMPLETED' ? 'completed' : 'pending',
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }
}
