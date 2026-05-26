'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.allocate = allocate;
/**
 * Largest-remainder algorithm: distributes `total` bigint across `weights` such that the
 * returned array sums to exactly `total`. Tiebreaks by original index (stable).
 *
 * Invariant §3.2 / §3.8: bigint-safe, no float drift, sum always equals total.
 */
function allocate(total, weights) {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  // Floor share for each weight
  const floors = weights.map((w) => (total * w) / sum);
  const allocated = floors.reduce((a, b) => a + b, 0n);
  let leftover = total - allocated;
  // Sort by remainder desc, tiebreak by index asc
  const remainders = weights.map((w, i) => ({ rem: (total * w) % sum, i }));
  remainders.sort((a, b) => (a.rem > b.rem ? -1 : a.rem < b.rem ? 1 : a.i - b.i));
  const result = [...floors];
  for (let k = 0; leftover > 0n; k++, leftover--) {
    result[remainders[k % remainders.length].i] += 1n;
  }
  return result;
}
//# sourceMappingURL=allocate.js.map
