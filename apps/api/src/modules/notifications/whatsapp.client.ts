import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsAppClient {
  private readonly logger = new Logger(WhatsAppClient.name);

  async sendOtp(to: string, code: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(`\n  OTP  ${to}  →  ${code}  (whatsapp, dev)\n\n`);
      return;
    }
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!phoneId || !token) throw new Error('WhatsApp credentials not configured');
    const resp = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: 'otp_code',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
        },
      }),
    });
    if (!resp.ok) {
      this.logger.error({ status: resp.status, to }, 'WhatsApp send failed');
      throw new Error(`WhatsApp send failed: ${resp.status}`);
    }
  }
}
