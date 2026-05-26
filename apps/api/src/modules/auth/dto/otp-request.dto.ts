import { z } from 'zod';

const PHONE_E164 = /^\+[1-9]\d{1,14}$/;

export const OtpRequestSchema = z.object({
  phone: z.string().regex(PHONE_E164, 'Phone must be E.164 format'),
});

export type OtpRequestDto = z.infer<typeof OtpRequestSchema>;
