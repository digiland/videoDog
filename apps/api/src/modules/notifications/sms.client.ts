import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SmsClient {
  private readonly logger = new Logger(SmsClient.name);

  async sendOtp(to: string, code: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log({ to, code, channel: 'sms' }, 'OTP code (dev)');
      return;
    }
    const apiKey = process.env.SMS_API_KEY;
    if (!apiKey) throw new Error('SMS API key not configured');
    const resp = await fetch('https://portal.bulkgate.com/api/1.0/simple/transactional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: apiKey,
        application_token: apiKey,
        number: to,
        text: `StreamZW verification code: ${code}. Valid for 10 minutes.`,
      }),
    });
    if (!resp.ok) {
      this.logger.error({ status: resp.status, to }, 'SMS send failed');
      throw new Error(`SMS send failed: ${resp.status}`);
    }
  }
}
