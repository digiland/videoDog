import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AuthForbiddenError } from '../auth/errors';

/**
 * Hooks called by the live server (MediaMTX auth, the live worker) carry a shared secret:
 * `x-live-secret` header, or `?secret=` for MediaMTX, which can't set headers.
 */
@Injectable()
export class LiveIngestGuard implements CanActivate {
  private readonly secret = process.env.LIVE_INGEST_SECRET ?? '';

  constructor() {
    if (process.env.NODE_ENV === 'production' && this.secret.length < 16) {
      throw new Error('LIVE_INGEST_SECRET must be set (16+ chars) in production');
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['x-live-secret'];
    const query = req.query.secret;
    const given =
      (typeof header === 'string' ? header : typeof query === 'string' ? query : '') ?? '';
    const expected = this.secret || 'dev-live-ingest-secret';
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthForbiddenError();
    return true;
  }
}
