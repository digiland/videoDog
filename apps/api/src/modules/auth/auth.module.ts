import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { JwtTokenService } from './jwt.service';
import { OtpService } from './otp.service';
import { RequireAuthGuard } from './require-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    JwtModule.register({}), // secrets provided per-call in JwtTokenService
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, JwtTokenService, JwtGuard, RequireAuthGuard, RolesGuard],
  exports: [JwtGuard, RequireAuthGuard, RolesGuard, JwtTokenService, AuthService],
})
export class AuthModule {}
