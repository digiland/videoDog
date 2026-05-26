import { DomainError } from '@streamzw/shared';

export class OtpExpiredError extends DomainError {
  constructor() {
    super('OTP_EXPIRED', 'OTP has expired', 401);
  }
}

export class OtpInvalidError extends DomainError {
  constructor() {
    super('OTP_INVALID', 'Invalid OTP code', 401);
  }
}

export class OtpLockedError extends DomainError {
  constructor() {
    super('OTP_LOCKED', 'Too many attempts — wait 15 minutes', 429);
  }
}

export class AuthTokenExpiredError extends DomainError {
  constructor() {
    super('AUTH_TOKEN_EXPIRED', 'Token expired', 401);
  }
}

export class AuthTokenInvalidError extends DomainError {
  constructor() {
    super('AUTH_TOKEN_INVALID', 'Invalid token', 401);
  }
}

export class AuthTokenReusedError extends DomainError {
  constructor() {
    super('AUTH_TOKEN_REUSED', 'Refresh token reuse detected — all sessions revoked', 401);
  }
}

export class AuthForbiddenError extends DomainError {
  constructor() {
    super('AUTH_FORBIDDEN', 'Forbidden', 403);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `Cannot transition ${from} → ${to}`, 409);
  }
}

export class LedgerImbalanceError extends DomainError {
  constructor(currency: string) {
    super('LEDGER_IMBALANCE', `Ledger imbalanced for ${currency}`, 500);
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 422);
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor() {
    super('INSUFFICIENT_BALANCE', 'Insufficient balance for payout', 422);
  }
}
