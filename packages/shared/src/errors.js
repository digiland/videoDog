'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.CurrencyMismatchError = exports.DomainError = void 0;
class DomainError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}
exports.DomainError = DomainError;
class CurrencyMismatchError extends DomainError {
  constructor(left, right) {
    super('CURRENCY_MISMATCH', `Cannot operate across currencies: ${left} vs ${right}`, 400);
  }
}
exports.CurrencyMismatchError = CurrencyMismatchError;
//# sourceMappingURL=errors.js.map
