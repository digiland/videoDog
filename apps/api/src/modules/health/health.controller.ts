import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis.module';
import { DB, type Db } from '../../db/db.module';

type HealthResponse = { ok: boolean; db: boolean; redis: boolean };

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [dbOk, redisOk] = await Promise.all([this.pingDb(), this.pingRedis()]);
    const ok = dbOk && redisOk;
    if (!ok) {
      throw new HttpException(
        { ok, db: dbOk, redis: redisOk } satisfies HealthResponse,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { ok, db: dbOk, redis: redisOk };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  private async pingRedis(): Promise<boolean> {
    try {
      const reply = await this.redis.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }
}
