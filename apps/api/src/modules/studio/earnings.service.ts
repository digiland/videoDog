import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { accounts, ledgerEntries } from '../../db/schema';
import { Money } from '@streamzw/shared';

@Injectable()
export class EarningsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getEarnings(creatorId: string, month: string) {
    // month format: YYYY-MM
    const [year, mon] = month.split('-').map(Number);
    if (!year || !mon) return this.zeroEarnings(month);

    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 1);

    // Get creator's USD creator_balance account
    const [acc] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.scope, 'user'),
          eq(accounts.ownerId, creatorId),
          eq(accounts.code, 'creator_balance'),
          eq(accounts.currency, 'USD'),
        ),
      )
      .limit(1);

    if (!acc) return this.zeroEarnings(month);

    // Credits by ref_type for this month
    const entries = await this.db
      .select({
        refType: ledgerEntries.refType,
        total: sql<string>`SUM(credit_minor::bigint)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, acc.id),
          gte(ledgerEntries.occurredAt, from),
          lt(ledgerEntries.occurredAt, to),
        ),
      )
      .groupBy(ledgerEntries.refType);

    const byType: Record<string, bigint> = {};
    for (const e of entries) {
      byType[e.refType] = BigInt(e.total ?? '0');
    }

    const ppv = byType['purchase'] ?? 0n;
    const premiumPayout = byType['premium_payout'] ?? 0n;
    const tips = byType['tip'] ?? 0n;
    const total = ppv + premiumPayout + tips;

    return {
      month,
      ppv_amount: new Money(ppv, 'USD').toJSON(),
      premium_pool_estimate: new Money(premiumPayout, 'USD').toJSON(),
      tips_amount: new Money(tips, 'USD').toJSON(),
      total: new Money(total, 'USD').toJSON(),
    };
  }

  private zeroEarnings(month: string) {
    const zero = new Money(0n, 'USD').toJSON();
    return {
      month,
      ppv_amount: zero,
      premium_pool_estimate: zero,
      tips_amount: zero,
      total: zero,
    };
  }
}
