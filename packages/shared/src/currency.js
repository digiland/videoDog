'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.CURRENCY_CODES = void 0;
exports.isCurrencyCode = isCurrencyCode;
exports.CURRENCY_CODES = ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP'];
function isCurrencyCode(value) {
  return typeof value === 'string' && exports.CURRENCY_CODES.includes(value);
}
//# sourceMappingURL=currency.js.map
