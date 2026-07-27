# for-swap-effect-deps (plan D2)

## What was tried

Gave parent-mode `For`'s swap-detection layout effect a deps array so the
alien-signals effect survives same-array structural renders (append/remove)
instead of being torn down and re-created on every `For` render. Design per
`notes/performance/elements-signal-plan.md` D2, on top of accepted D1
(`$ELEMENTS`):

- `useIsomorphicLayoutEffect(..., [raw, parent, isEmpty])` — re-create only
  when the array reference changes or the array transitions empty↔nonempty.
- Render-path snapshot refresh (`prevRawRef.current = [...raw]` in the
  parent branch) so a swap immediately after an append still diffs against
  fresh contents.
- `isEmpty` had to be its own dep: js-krauset's `add()` pushes onto the
  initially-empty array, so the effect must be created on the emptiness
  transition even though `raw`'s identity never changes. The first version
  without it shipped a real bug — caught by the dist swap test
  (`add → swaprows` produced no DOM fix because no effect was ever created).

## Hypothesis

Plan D2: append pays 1,000 unsubscribes + 2,000 resubscribes inside the
commit; effect reuse should remove that churn, improving append measurably
and remove slightly.

## Results

Interleaved A/B (12 pairs, alternating kernel dist within one window;
script, ms):

| benchmark  | d1 med | d1+d2 med | diff   | pairs positive |
| ---------- | ------ | --------- | ------ | -------------- |
| append 1k  | 29.26  | 29.33     | +0.3%  | 5/12           |
| remove row | 8.76   | 9.16      | +4.5%  | 5/12           |
| swap rows  | 3.13   | 2.68      | −14.2% | 5/12           |
| create 10k | 555.72 | 560.84    | +0.9%  | —              |
| clear      | 77.69  | 84.86     | +9.2%  | —              |
| partial    | 26.03  | 21.05     | −19.1% | —              |

The targeted benchmarks (append, remove) are dead flat — 5/12 positive
pairs is a coin flip. The large swings land on benchmarks D2 cannot
mechanically touch (partial update does not re-render `For` at all), i.e.
window noise / GC-aliasing class variance, not signal.

## Why it failed

**D1 already harvested this slice.** The hypothesis was written against the
per-index baseline, where every effect re-creation performed O(N) graph
ops. After `$ELEMENTS`, the swap effect has exactly ONE dependency —
re-creating it on append costs ~2 graph ops (one unlink, one link) plus one
effect allocation. There is nothing left for reuse to save. Meanwhile D2
added a render-phase ref write (`[...raw]` copy per structural render), an
emptiness-transition dep with StrictMode double-invoke surface, and a
demonstrated footgun (the add-from-empty bug above).

Rejected as **obsoleted by D1**, not merely unmeasurable. The interleaving
tests written for it (push-from-empty→swap, splice-to-empty→refill→swap,
append→swap-across-appended-index, remove→swap) were kept — they lock in
parent-mode semantics regardless of implementation.
