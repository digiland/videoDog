import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { DomainErrorFilter } from './common/filters/domain-error.filter';
import { RedisModule } from './common/redis.module';
import { DbModule } from './db/db.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FxModule } from './modules/fx/fx.module';
import { VideosModule } from './modules/videos/videos.module';
import { WatchModule } from './modules/watch/watch.module';
import { SearchModule } from './modules/search/search.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { StudioModule } from './modules/studio/studio.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SchedulerService } from './workers/scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        autoLogging: true,
        customProps: () => ({ service: 'api' }),
      },
    }),
    DbModule,
    RedisModule,
    StorageModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    FxModule,
    VideosModule,
    WatchModule,
    SearchModule,
    PaymentsModule,
    SubscriptionsModule,
    WalletModule,
    StudioModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DomainErrorFilter,
    },
    SchedulerService,
  ],
})
export class AppModule {}
