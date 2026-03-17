# Benchmark Analysis: Supergrain vs solid-js

> **Status**: Historical / largely superseded by [consolidated-findings.md](./consolidated-findings.md).
> **Important**: The "12,000x slower" reactive reads figure in this doc was caused by a benchmark bug (async `createEffect` in Node.js). Corrected numbers are 27-66x slower. See [performance-analysis.md](./performance-analysis.md).

> **TL;DR**: Supergrain wins on complex object updates (2.3x faster) and array push (1.56x). solid-js wins on reads (12,000x -- but see bug note above), effect tracking, and batch updates. MongoDB operators are well-optimized (1.3M ops/sec for `$set`).

## Winners by Category

| Category | Winner | Advantage |
|----------|--------|-----------|
| Store Creation | solid-js | 38-45x faster |
| Reactive Property Reads | solid-js | 12,000x faster (**BUGGED -- see note**) |
| Non-Reactive Reads | solid-js | 162-179x faster |
| Property Updates | solid-js | 1.2-1.3x faster |
| Array Push | @supergrain/core | 1.56x faster |
| Array Remove | solid-js | 2-24x faster |
| Deep Object Access | solid-js | 143-3,552x faster |
| Batch Updates | solid-js | 2.3-5.4x faster |
| Effect Tracking | solid-js | 58-2,210x faster |

## Raw Numbers

### Store/Proxy Creation (1,000 stores)
| | ops/sec |
|-|---------|
| @supergrain/core | 843 |
| solid-js | 38,129 |

### Reactive Property Access (10k reads in single effect)
| | ops/sec |
|-|---------|
| @supergrain/core | 1,212 |
| solid-js | 14,687,833 |

### Non-Reactive Property Access (10k reads)
| | ops/sec |
|-|---------|
| @supergrain/core | 5,069 |
| solid-js | 246,457 |
| Plain Object | 247,783 |

### Property Mutations (1k updates with active effect)
| | ops/sec |
|-|---------|
| @supergrain/core | 11,070 |
| solid-js | 12,137 |

### Deep Object Updates
| | ops/sec |
|-|---------|
| @supergrain/core | 2,823 |
| solid-js | 1,248 |

## MongoDB Update Operators

| Operator | ops/sec | Mean Time |
|----------|---------|-----------|
| `$set` - single field | 1,271,016 | 0.8us |
| `$set` - multiple fields | 539,061 | 1.9us |
| `$inc` - single field | 1,307,337 | 0.8us |
| `$push` - single item | 550,285 | 1.8us |
| `$addToSet` | 316,172 | 3.2us |
| Complex nested update | 115,103 | 8.7us |

## Proxy Overhead vs Plain Objects

| Operation | Plain Object | Proxy | Overhead |
|-----------|-------------|-------|----------|
| Property Read | 30,349 ops/sec | 520 ops/sec | 58x |
| Property Write | 30,030 ops/sec | 501 ops/sec | 60x |
| Deep Property Read | 30,397 ops/sec | 74 ops/sec | 411x |
| Array Push | 28,662 ops/sec | 2,107 ops/sec | 14x |
| Array Splice | 21,778 ops/sec | 61 ops/sec | 357x |
