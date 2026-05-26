import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatchController } from './watch.controller';
import { WatchService } from './watch.service';

@Module({
  imports: [AuthModule],
  controllers: [WatchController],
  providers: [WatchService],
  exports: [WatchService],
})
export class WatchModule {}
