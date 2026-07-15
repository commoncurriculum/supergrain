/**
 * Shallow array equality
 */
export function arrayEqual<T>(a: Array<T>, b: Array<T>): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}
