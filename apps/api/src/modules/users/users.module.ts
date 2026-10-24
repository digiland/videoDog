import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelsController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, ChannelsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
