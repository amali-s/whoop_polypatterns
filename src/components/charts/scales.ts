import { scaleLinear, scaleBand, scaleTime, scaleOrdinal } from 'd3-scale';
import { extent as d3extent } from 'd3-array';

export { scaleLinear, scaleBand, scaleTime, scaleOrdinal };

/**
 * `d3.extent` typed loosely returns `[undefined, undefined]` on an empty
 * array. This wraps it with an explicit fallback domain so callers never
 * have to null-check a scale domain — charts with no data render an empty
 * (but structurally valid) axis rather than throwing.
 */
export function safeExtent<T>(
  values: readonly T[],
  accessor: (d: T) => number | null | undefined,
  fallback: [number, number] = [0, 1],
): [number, number] {
  const nums = values
    .map(accessor)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) {
    return fallback;
  }
  const [min, max] = d3extent(nums) as [number, number];
  return min === max ? [min - 1, max + 1] : [min, max];
}

/** Day-scale domain from an array of ISO 'YYYY-MM-DD' day strings. */
export function dayDomain(days: readonly string[]): [Date, Date] {
  if (days.length === 0) {
    const now = new Date();
    return [now, now];
  }
  const sorted = [...days].sort();
  return [new Date(sorted[0]), new Date(sorted[sorted.length - 1])];
}
