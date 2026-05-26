import { Module } from '@nestjs/common';
import { WhatsAppClient } from './whatsapp.client';
import { SmsClient } from './sms.client';

@Module({
  providers: [WhatsAppClient, SmsClient],
  exports: [WhatsAppClient, SmsClient],
})
export class NotificationsModule {}
