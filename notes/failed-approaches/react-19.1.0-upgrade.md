# FAILED: React 19.1.0 Upgrade for Benchmark Performance

> **Status:** FAILED — No measurable difference (kept as stepping stone to 19.2.4)
> **Date:** March 2026
> **Commit:** 2540bfd
> **TL;DR:** Upgrading React from 19.0.0 to 19.1.0 showed no measurable script time difference in local benchmarks. The hypothesis that newer React = faster benchmarks did not hold for this version.

## Context

The official js-framework-benchmark data (`benchmark-data/react-benchmark-pivot.csv`) showed `react-hooks-v19.2.4` outperforming `react-hooks-v19.0.0` on creation benchmarks. Hypothesis: upgrading React would improve our scores.

## What Was Tried

Upgraded React from 19.0.0 to 19.1.0 (latest available at the time) in the benchmark package.

## Results

Local perf tests showed **no measurable script time difference** across all benchmark operations. The improvement seen in the Krause data between 19.0.0 and 19.2.4 was either:
- Specific to the 19.2.4 release (not incremental across minor versions)
- Within measurement noise on the Krause harness
- Dependent on other factors (machine, browser version, etc.)

## What Happened Next

Later upgraded to 19.2.4 (commit 7624162), which is the exact version used by the fastest React benchmark entry. The 19.1.0 step was unnecessary — could have gone directly to 19.2.4.

## Key Lesson

Don't assume incremental React minor versions bring incremental performance gains. Benchmark data from one harness/machine doesn't necessarily transfer. Test the specific version you care about directly.
