/**
 * Fibonacci backoff: delay for attempt N is `fib(N) * 1000`, clamped to
 * `[min, max]`. Default bounds match the app's historical config (1s–60s).
 */
export function fibonacciBackoff(attempt: number, min = 1000, max = 60_000): number {
  if (attempt <= 0) return min;
  let a = 1;
  let b = 1;
  for (let i = 1; i < attempt; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return Math.min(Math.max(a * 1000, min), max);
}
