import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchController } from './search.controller';

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
})
export class SearchModule {}
