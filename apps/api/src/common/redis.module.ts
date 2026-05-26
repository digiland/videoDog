import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (): Redis => {
        const url = process.env.REDIS_URL;
        if (!url) throw new Error('REDIS_URL is required');
        return new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor() {}
  onModuleDestroy(): void {
    // Connection cleanup handled by ioredis on process exit.
  }
}
