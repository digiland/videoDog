/**
 * Largest-remainder algorithm: distributes `total` bigint across `weights` such that the
 * returned array sums to exactly `total`. Tiebreaks by original index (stable).
 *
 * Invariant §3.2 / §3.8: bigint-safe, no float drift, sum always equals total.
 */
export declare function allocate(total: bigint, weights: bigint[]): bigint[];
//# sourceMappingURL=allocate.d.ts.map
