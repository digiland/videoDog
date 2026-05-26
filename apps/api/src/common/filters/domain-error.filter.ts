import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { DomainError } from '@streamzw/shared';
import type { Response } from 'express';

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    this.logger.warn({ code: exception.code, msg: exception.message });
    res.status(exception.statusCode).json({
      error: {
        code: exception.code,
        message: exception.message,
      },
    });
  }
}
