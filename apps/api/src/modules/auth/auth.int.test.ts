import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { connect, hasDb, makeUser } from '../../test/harness';
import { AuthService, type TokenPair } from './auth.service';
import { JwtTokenService } from './jwt.service';
import type { OtpService } from './otp.service';
import type { Db } from '../../db/db.module';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef';

describe.skipIf(!hasDb)('refresh token rotation (integration)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let auth: AuthService;

  beforeAll(() => {
    ({ db, close } = connect());
    auth = new AuthService(db, {} as OtpService, new JwtTokenService(new JwtService()));
  });
  afterAll(async () => close());

  async function login(): Promise<TokenPair> {
    const user = await makeUser(db);
    // issueTokens is the post-OTP step; OTP itself is out of scope here.
    const issue = (
      auth as unknown as {
        issueTokens(id: string, role: string): Promise<{ pair: TokenPair }>;
      }
    ).issueTokens.bind(auth);
    return (await issue(user.id, user.role)).pair;
  }

  it('rotates on use and rejects the spent token', async () => {
    const first = await login();
    const second = await auth.refreshTokens(first.refresh_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(auth.refreshTokens(first.refresh_token)).rejects.toThrow();
  });

  it('on reuse, also revokes the tokens issued after the stolen one', async () => {
    const first = await login();
    const second = await auth.refreshTokens(first.refresh_token);
    await expect(auth.refreshTokens(first.refresh_token)).rejects.toThrow(); // reuse
    await expect(auth.refreshTokens(second.refresh_token)).rejects.toThrow(); // chain revoked
  });

  it('lets only one of two concurrent refreshes win', async () => {
    const first = await login();
    const results = await Promise.allSettled([
      auth.refreshTokens(first.refresh_token),
      auth.refreshTokens(first.refresh_token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
