# Core Architecture

`@supergrain/kernel` is organized around four internal layers:

- `core.ts`
  Shared primitives: brand/types, symbol slots, raw unwrapping, and per-property signal storage.
- `read.ts`
  Read-time behavior: proxy reads, dependency tracking, and compiled readonly views.
- `write.ts`
  Write-time behavior: direct mutation handling, structural invalidation, and version bumps.
- `typed.ts`
  Schema-backed compiled views layered on top of the read primitives.

## Runtime Model

`createStore()` returns a reactive proxy plus an update function.

- Proxy reads subscribe through signal nodes created on demand.
- Proxy writes and operator writes flow through `setProperty()`.
- Batch updates use `alien-signals` batching around `update()`.
- The root state must be a plain object or array. Primitive roots are rejected.

## View Contracts

`createView()` and typed views are readonly facades over the same signal graph.

- Their public properties are enumerable own getters so they behave like normal objects.
- Internal signal state is stored on a hidden `_n` slot.
- Views are frozen after creation to make the readonly contract explicit at runtime.
- Writes must go through the store proxy or the update function, not the view facade.

## Typed Store Contract

Typed stores have an additional invariant:

- A raw object may only be associated with one typed schema entry.

Reusing the same raw object with a different typed schema throws immediately instead of silently returning a mismatched cached view.

## Path Updates

Operator paths are centralized in `path.ts`.

- Empty paths are rejected.
- Empty path segments such as `user..name` are rejected.
- Path traversal and parent creation are shared across operators to keep mutation semantics consistent.
- Unstructured stores use permissive string-path updates.
- Typed stores use stricter path/value typing on their returned update function.
- Array operators require an existing array target and throw for mismatched paths.
- Numeric operators require an existing numeric target when the path already exists.
- `$rename` refuses to overwrite an existing destination path implicitly.

## Public API

The package root intentionally exports the supported consumer surface:

- `createStore`
- `createView`
- `unwrap`
- `$BRAND`
- update operator types/functions
- `alien-signals` primitives re-exported for convenience

Low-level mutation helpers and internal symbol slots remain internal so the runtime can evolve without pinning those details as public API.

## Internal Entry Point

Repo-local benchmarks and tests that need internals import from `src/internal.ts`.

- This keeps internal access explicit.
- It avoids making internal runtime details part of the package-root contract.
