import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideosModule } from '../videos/videos.module';
import { WatchController } from './watch.controller';
import { WatchService } from './watch.service';
import { WatchRepository } from './watch.repository';

@Module({
  imports: [AuthModule, VideosModule],
  controllers: [WatchController],
  providers: [WatchService, WatchRepository],
  exports: [WatchService],
})
export class WatchModule {}
