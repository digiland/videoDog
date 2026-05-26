import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AuthForbiddenError } from './errors';
import type { AuthenticatedRequest } from './jwt.guard';

/**
 * Requires a valid JWT (non-empty user id). Use after JwtGuard.
 */
@Injectable()
export class RequireAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user?.id) throw new AuthForbiddenError();
    return true;
  }
}
