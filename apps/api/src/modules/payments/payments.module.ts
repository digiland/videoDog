import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../fx/fx.module';
import { LedgerService } from './ledger.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, FxModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, LedgerService],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
