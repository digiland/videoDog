import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtTokenService } from './jwt.service';

export const IS_PUBLIC_KEY = 'isPublic';

export interface AuthenticatedRequest extends Request {
  user: { id: string; role: string };
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtSvc: JwtTokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      // Allow optional auth — attach null user
      (req as AuthenticatedRequest).user = { id: '', role: 'viewer' };
      return true;
    }

    const token = authHeader.slice(7);
    const payload = this.jwtSvc.verifyAccess(token); // throws on invalid/expired
    (req as AuthenticatedRequest).user = { id: payload.sub, role: payload.role };
    return true;
  }
}
