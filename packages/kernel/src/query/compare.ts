export function isMissing(value: unknown): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

/**
 * A total order over numbers, strings, bigints and arrays of them. Values of
 * different types order by type name; `null`, `undefined` and `NaN` sort last.
 */
export function defaultCompare(a: unknown, b: unknown): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const order = defaultCompare(a[i], b[i]);
      if (order !== 0) return order;
    }
    return a.length - b.length;
  }
  const aType = typeof a;
  const bType = typeof b;
  if (aType !== bType) return aType < bType ? -1 : 1;
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}
