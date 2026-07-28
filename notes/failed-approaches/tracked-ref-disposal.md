# tracked-ref-disposal (D3)

## What was tried

An opt-in `tracked(Component, { refDisposal: true })` mode that disposed a
tracked component's alien-signals effect via a React 19 ref cleanup instead of
the default per-instance `useEffect`. The wrapper injected a stable
`trackedRef` prop for the component to attach to its root DOM element; the
ref's cleanup flagged detachment and queued the graph unlink through the
existing deferred disposal queue (StrictMode-safe via a re-attach-cancels
flag). Development builds warned and disposed if the ref was never attached;
production trusted the contract. Default behavior — and every existing
`tracked()` call — was unchanged.

The implementation was complete and correct: typecheck/lint/format clean, 5
new kernel tests passing (reactivity, unmount disposal, StrictMode survival,
dev leak-guard, no-injection-by-default), and the js-krauset dist suite green
with the mode active. The app change was forward/backward compatible — the
old kernel ignores the extra option and the undefined `trackedRef`.

## Hypothesis

Each of the 10k benchmark rows mounts a passive effect whose only job is
unmount disposal. Removing it should shave effect-creation cost on the create
benchmarks and the passive-unmount traversal on clear/remove. Expected 1-4%
on clear rows / replace all rows.

## Results (2026-07-27, local quiet machine, interleave protocol)

Full suite, 12 interleaved pairs (`perf-ab.ts`, HEAD vs D3): nothing
significant. clear rows −4.5% (8/12, p=0.388) and replace all rows −4.5%
(9/12, p=0.146) leaned favorably, so a focused free-running interleave with
16 pairs was run on exactly those two benchmarks:

| Benchmark        | Δ median | pairs improved | sign test p |
| ---------------- | -------- | -------------- | ----------- |
| clear rows       | +0.7%    | 6/15           | 0.607       |
| replace all rows | −0.2%    | 8/15           | 1.000       |

Flat. The full-suite leans were noise.

## Why it failed

The per-row passive effect is simply not where the time is. D0's attribution
holds: React's DOM commit dominates create/clear, and the deferred disposal
queue had already moved the O(subscriptions) unlink work off the
paint-critical path — what the `useEffect` still cost (creation at mount,
traversal at unmount) is evidently below measurement resolution even at 10k
rows. An opt-in public API whose contract can silently leak (component must
attach the injected ref) is not worth keeping for a measured effect of zero;
reverted in full.

## If revisiting

Only worth another look if React's passive-effect bookkeeping becomes
measurably more expensive (e.g., a React version change), or if profiling
shows `commitHookEffectListMount`/`commitPassiveUnmountEffects` as material
self-time in the create/clear traces. The reverted implementation is in git
history (search for `refDisposal`) and was correct as of this note — the
StrictMode detach/re-attach cancellation and the dev leak guard are the two
subtle parts worth re-reading before reimplementing.
