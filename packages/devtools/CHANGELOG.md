# @supergrain/devtools

## 7.2.0

### Patch Changes

- Updated dependencies [9dffca6]
- Updated dependencies [9dffca6]
  - @supergrain/kernel@7.2.0
  - @supergrain/silo@7.2.0

## 7.1.0

### Patch Changes

- @supergrain/kernel@7.1.0
- @supergrain/silo@7.1.0

## 7.0.1

### Patch Changes

- @supergrain/kernel@7.0.1
- @supergrain/silo@7.0.1

## 7.0.0

### Patch Changes

- @supergrain/kernel@7.0.0
- @supergrain/silo@7.0.0

## 6.3.0

### Minor Changes

- c959d10: Add `@supergrain/devtools`: a floating panel for inspecting a silo `DocumentStore`, modeled on the TanStack Query devtools.

  - `@supergrain/devtools/react` exports `<SupergrainDevtools store={store} />` — a corner toggle that opens a master/detail inspector over the store's cached documents and query results: live status badges, a metadata grid, and a collapsible value explorer. Tabs, counts, and the open detail update reactively as fetches settle and documents change, and inspecting never calls `find`, so opening it can't trigger a fetch.
  - `@supergrain/devtools` (framework-agnostic core) exports `snapshotSilo()` and `serialize()` for building custom inspectors.
  - `@supergrain/silo` now exposes a non-enumerable devtools bridge under `@supergrain/silo/devtools` (`getSiloDevtools`, `SILO_DEVTOOLS`) so tooling can read and subscribe to a store's internal state. Purely observational — no change to the public store surface.

### Patch Changes

- Updated dependencies [c959d10]
  - @supergrain/silo@6.3.0
  - @supergrain/kernel@6.3.0
