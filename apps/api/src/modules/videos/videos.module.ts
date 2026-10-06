import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../fx/fx.module';
import { AccessService } from './access.service';
import { AdminGrantsController } from './admin-grants.controller';
import { VideosController, PurchasesController } from './videos.controller';
import { VideosService } from './videos.service';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

@Module({
  imports: [AuthModule, FxModule],
  controllers: [VideosController, AdminGrantsController, PurchasesController, PlaybackController],
  providers: [VideosService, AccessService, PlaybackService],
  exports: [VideosService, AccessService],
})
export class VideosModule {}
