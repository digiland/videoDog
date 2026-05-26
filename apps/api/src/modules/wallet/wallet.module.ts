import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../fx/fx.module';
import { PaymentsModule } from '../payments/payments.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule, FxModule, PaymentsModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
