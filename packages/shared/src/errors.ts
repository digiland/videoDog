export class DomainError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(left: string, right: string) {
    super('CURRENCY_MISMATCH', `Cannot operate across currencies: ${left} vs ${right}`, 400);
  }
}
