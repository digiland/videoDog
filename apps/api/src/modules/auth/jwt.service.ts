import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { AuthTokenExpiredError, AuthTokenInvalidError } from './errors';

export interface AccessTokenPayload {
  sub: string; // user id
  role: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // refresh token id in DB
  type: 'refresh';
}

@Injectable()
export class JwtTokenService {
  constructor(private readonly jwt: NestJwtService) {}

  signAccess(userId: string, role: string): string {
    const payload: AccessTokenPayload = { sub: userId, role, type: 'access' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.jwt.sign(payload as any, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as unknown as number,
    });
  }

  signRefresh(userId: string, tokenId: string): string {
    const payload: RefreshTokenPayload = { sub: userId, jti: tokenId, type: 'refresh' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.jwt.sign(payload as any, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_TTL ?? '30d') as unknown as number,
    });
  }

  verifyAccess(token: string): AccessTokenPayload {
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'access') throw new AuthTokenInvalidError();
      return payload;
    } catch (err) {
      if (err instanceof AuthTokenInvalidError) throw err;
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('expired')) throw new AuthTokenExpiredError();
      throw new AuthTokenInvalidError();
    }
  }

  verifyRefresh(token: string): RefreshTokenPayload {
    try {
      const payload = this.jwt.verify<RefreshTokenPayload>(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      if (payload.type !== 'refresh') throw new AuthTokenInvalidError();
      return payload;
    } catch (err) {
      if (err instanceof AuthTokenInvalidError) throw err;
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('expired')) throw new AuthTokenExpiredError();
      throw new AuthTokenInvalidError();
    }
  }
}
