// Krause benchmark weights (from js-framework-benchmark scoring), keyed by the
// benchmark names that perf.test.ts emits. Shared by perf-compare.ts (block-mode
// A/B over perf-stats files) and perf-ab.ts (interleaved A/B over two kernel
// builds) so the two reports can't drift apart.
export const KRAUSE_WEIGHTS: Record<string, number> = {
  "create rows (1k)": 0.64,
  "replace all rows": 0.56,
  "partial update (10th)": 0.56,
  "select row": 0.19,
  "swap rows": 0.13,
  "remove row": 0.53,
  "create many rows (10k)": 0.56,
  "append rows (1k to 1k)": 0.55,
  "clear rows": 0.42,
};
