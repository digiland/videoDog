import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module';
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

    const valid = await bcrypt.compare(rawRefreshToken, record.tokenHash).catch(() => false);
    if (!valid) throw new AuthTokenInvalidError();

    if (record.revokedAt || record.rotatedTo) {
      // A spent token was presented again: assume it was stolen and kill every token
      // issued from it, including whichever one the thief or the real user holds now.
      await this.revokeChain(record.id);
      throw new AuthTokenReusedError();
    }
    if (record.expiresAt <= new Date()) throw new AuthTokenInvalidError();

    const [user] = await this.db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user) throw new AuthTokenInvalidError();

    // Claim the old token atomically. If two refreshes race, only one wins; the loser is
    // treated as reuse, exactly as if it had arrived after the rotation.
    const issued = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ rotatedTo: refreshTokens.rotatedTo, revokedAt: refreshTokens.revokedAt })
        .from(refreshTokens)
        .where(eq(refreshTokens.id, record.id))
        .for('update');
      if (!locked || locked.rotatedTo || locked.revokedAt) return null;

      const next = await this.issueTokens(user.id, user.role, tx);
      await tx
        .update(refreshTokens)
        .set({ rotatedTo: next.tokenId })
        .where(eq(refreshTokens.id, record.id));
      return next;
    });

    if (!issued) {
      await this.revokeChain(record.id);
      throw new AuthTokenReusedError();
    }
    return issued.pair;
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
    exec: DbOrTx = this.db,
  ): Promise<{ pair: TokenPair; tokenId: string }> {
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const accessToken = this.jwtSvc.signAccess(userId, role);
    const refreshToken = this.jwtSvc.signRefresh(userId, tokenId);
    const hash = await bcrypt.hash(refreshToken, 10);

    await exec.insert(refreshTokens).values({
      id: tokenId,
      userId,
      tokenHash: hash,
      expiresAt,
    });

    return { pair: { access_token: accessToken, refresh_token: refreshToken }, tokenId };
  }

  /** Revoke a token and every token rotated from it (the whole forward chain). */
  private async revokeChain(tokenId: string): Promise<void> {
    const ids: string[] = [];
    let next: string | null = tokenId;
    while (next && !ids.includes(next)) {
      ids.push(next);
      const [row] = await this.db
        .select({ rotatedTo: refreshTokens.rotatedTo })
        .from(refreshTokens)
        .where(eq(refreshTokens.id, next))
        .limit(1);
      next = row?.rotatedTo ?? null;
    }
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(inArray(refreshTokens.id, ids), isNull(refreshTokens.revokedAt)));
  }
}
