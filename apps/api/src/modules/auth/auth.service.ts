import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { refreshTokens, users } from '../../db/schema';
import { OtpService } from './otp.service';
import { JwtTokenService } from './jwt.service';
import { AuthTokenInvalidError, AuthTokenReusedError } from './errors';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
    private readonly jwtSvc: JwtTokenService,
  ) {}

  async requestOtp(phone: string): Promise<void> {
    await this.otp.request(phone);
  }

  async verifyOtpAndLogin(phone: string, code: string): Promise<TokenPair> {
    await this.otp.verify(phone, code);

    // Upsert user
    let [user] = await this.db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);

    if (!user) {
      [user] = await this.db
        .insert(users)
        .values({
          phoneE164: phone,
          kycState: 'phone_verified',
        })
        .returning();
    } else if (user.kycState === 'none') {
      [user] = await this.db
        .update(users)
        .set({ kycState: 'phone_verified', updatedAt: new Date() })
        .where(eq(users.id, user!.id))
        .returning();
    }

    if (!user) throw new Error('Failed to upsert user');
    const { pair } = await this.issueTokens(user.id, user.role);
    return pair;
  }

  async refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
    const payload = this.jwtSvc.verifyRefresh(rawRefreshToken);

    const [record] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, payload.jti))
      .limit(1);

    if (!record) throw new AuthTokenInvalidError();
    if (record.revokedAt) {
      // Token was revoked — possible reuse attack; revoke entire chain
      await this.revokeChain(record.id);
      throw new AuthTokenReusedError();
    }
    if (record.rotatedTo) {
      // Already rotated = reuse
      await this.revokeChain(record.id);
      throw new AuthTokenReusedError();
    }

    const storedHash = record.tokenHash;
    const valid = await bcrypt.compare(rawRefreshToken, storedHash).catch(() => false);
    if (!valid) throw new AuthTokenInvalidError();

    // Fetch user for role
    const [user] = await this.db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user) throw new AuthTokenInvalidError();

    const { pair, tokenId: newTokenId } = await this.issueTokens(user.id, user.role);

    // Mark old token as rotated to new
    await this.db
      .update(refreshTokens)
      .set({ rotatedTo: newTokenId })
      .where(eq(refreshTokens.id, record.id));

    return pair;
  }

  async logout(rawRefreshToken: string): Promise<void> {
    try {
      const payload = this.jwtSvc.verifyRefresh(rawRefreshToken);
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, payload.jti));
    } catch {
      // Ignore errors on logout
    }
  }

  private async issueTokens(
    userId: string,
    role: string,
  ): Promise<{ pair: TokenPair; tokenId: string }> {
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const accessToken = this.jwtSvc.signAccess(userId, role);
    const refreshToken = this.jwtSvc.signRefresh(userId, tokenId);
    const hash = await bcrypt.hash(refreshToken, 10);

    await this.db.insert(refreshTokens).values({
      id: tokenId,
      userId,
      tokenHash: hash,
      expiresAt,
    });

    return { pair: { access_token: accessToken, refresh_token: refreshToken }, tokenId };
  }

  private async revokeChain(tokenId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, tokenId));
  }
}
