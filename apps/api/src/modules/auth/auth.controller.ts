import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../common/redis.module';
import { AuthService } from './auth.service';
import { ValidationError } from './errors';
import { OtpRequestSchema } from './dto/otp-request.dto';
import { z } from 'zod';

const OtpVerifySchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
  code: z.string().length(6),
});

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestOtp(@Body() body: unknown): Promise<void> {
    const parsed = OtpRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');

    const phone = parsed.data.phone;
    // Rate limit: 1/60s per phone, 5/hour. Disabled when OTP_RATE_LIMIT=off (dev).
    if (process.env.OTP_RATE_LIMIT !== 'off') {
      const keyMin = `otp:req:min:${phone}`;
      const keyHour = `otp:req:hour:${phone}`;

      const [countMin, countHour] = await Promise.all([
        this.redis.incr(keyMin),
        this.redis.incr(keyHour),
      ]);

      if (countMin === 1) await this.redis.expire(keyMin, 60);
      if (countHour === 1) await this.redis.expire(keyHour, 3600);

      if (countMin > 1)
        throw new ValidationError('Rate limit: wait 60 seconds between OTP requests');
      if (countHour > 5) throw new ValidationError('Rate limit: max 5 OTP requests per hour');
    }

    await this.auth.requestOtp(phone);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() body: unknown) {
    const parsed = OtpVerifySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid');
    return this.auth.verifyOtpAndLogin(parsed.data.phone, parsed.data.code);
  }

  @Post('refresh')
  async refresh(@Body() body: unknown) {
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('refresh_token required');
    return this.auth.refreshTokens(parsed.data.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) return;
    await this.auth.logout(parsed.data.refresh_token);
  }
}
