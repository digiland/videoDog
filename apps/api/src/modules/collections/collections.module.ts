import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideosModule } from '../videos/videos.module';
import { CollectionsController } from './collections.controller';
import { CollectionsRepository } from './collections.repository';
import { CollectionsService } from './collections.service';

@Module({
  imports: [AuthModule, VideosModule],
  controllers: [CollectionsController],
  providers: [CollectionsService, CollectionsRepository],
})
export class CollectionsModule {}
