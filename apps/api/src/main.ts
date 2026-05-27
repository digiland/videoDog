import './bootstrap-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { DB, type Db } from './db/db.module';
import { StorageService } from './storage/storage.service';
import { LedgerService } from './modules/payments/ledger.service';
import { createTranscodeWorker } from './workers/transcode.worker';
import { createThumbnailWorker } from './workers/thumbnail.worker';
import { createWatchAggregateWorker } from './workers/watch-aggregate.worker';
import { createPremiumPoolWorker } from './workers/premium-pool.worker';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3030,http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const db = app.get<Db>(DB);
  const storage = app.get(StorageService);
  const ledger = app.get(LedgerService);
  const workers = [
    createTranscodeWorker(redisUrl, db, storage),
    createThumbnailWorker(redisUrl, db, storage),
    createWatchAggregateWorker(redisUrl, db),
    createPremiumPoolWorker(redisUrl, db, ledger),
  ];
  const shutdown = async (): Promise<void> => {
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
}

void bootstrap();
