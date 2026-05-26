import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from './analytics.service';
import { EarningsService } from './earnings.service';
import { StudioController } from './studio.controller';

@Module({
  imports: [AuthModule],
  controllers: [StudioController],
  providers: [EarningsService, AnalyticsService],
  exports: [EarningsService, AnalyticsService],
})
export class StudioModule {}
