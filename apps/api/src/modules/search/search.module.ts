import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideosModule } from '../videos/videos.module';
import { SearchController } from './search.controller';

@Module({
  imports: [AuthModule, VideosModule],
  controllers: [SearchController],
})
export class SearchModule {}
