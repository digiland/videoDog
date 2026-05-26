import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { OxrClient } from './oxr.client';
import { RbzScraper } from './rbz.scraper';

@Module({
  imports: [AuthModule],
  controllers: [FxController],
  providers: [FxService, RbzScraper, OxrClient],
  exports: [FxService, RbzScraper, OxrClient],
})
export class FxModule {}
