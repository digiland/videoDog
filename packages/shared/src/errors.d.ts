export declare class DomainError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode?: number);
}
export declare class CurrencyMismatchError extends DomainError {
  constructor(left: string, right: string);
}
//# sourceMappingURL=errors.d.ts.map
