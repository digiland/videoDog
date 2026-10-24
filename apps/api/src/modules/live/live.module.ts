import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideosModule } from '../videos/videos.module';
import { LiveController } from './live.controller';
import { LiveIngestGuard } from './ingest.guard';
import { LiveService } from './live.service';

@Module({
  imports: [AuthModule, VideosModule],
  controllers: [LiveController],
  providers: [LiveService, LiveIngestGuard],
  exports: [LiveService],
})
export class LiveModule {}
