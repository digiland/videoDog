import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis.module';
import { pingDb } from './health.repository';
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
      await pingDb(this.db);
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
