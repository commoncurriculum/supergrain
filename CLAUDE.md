# AI Assistant Instructions for Supergrain Project

This document provides important instructions for AI assistants working on the Supergrain project.

## Project Overview

Supergrain is a reactive store library with fine-grained reactivity. The project uses pnpm workspaces with multiple packages:

- `@supergrain/core` - Core reactive store implementation
- `@supergrain/react` - React integration and hooks
- `@supergrain/store` - Document-oriented store for app-level state management
- `@supergrain/documentation` - Documentation and example tests
- `js-framework-benchmark-react-supergrain` - Performance benchmarks

## Required Commands After Code Changes

**IMPORTANT**: After making any code changes, you MUST run both tests and type checks:

### 1. Run Tests

```bash
pnpm test
```

### 2. Run Type Checks

```bash
pnpm run typecheck
```

### 3. Check Formatting

```bash
pnpm run format:check
```

All three commands must pass before considering any code changes complete. Run `pnpm run format` to auto-fix formatting issues.

## Package-specific Commands

If working on a specific package, you can run tests/typecheck for just that package:

```bash
# Run tests for specific package
cd packages/[package-name]
pnpm test

# Run typecheck for specific package
cd packages/[package-name]
pnpm run typecheck
```

## CI/CD

The project uses GitHub Actions CI that runs:

1. `pnpm run format:check` - Formatting via oxfmt
2. `pnpm test` - All tests across all packages
3. `pnpm run test:validate` - README documentation validation
4. `pnpm run typecheck` - Type checking across all packages

## Documentation Tests

The documentation package (`@supergrain/documentation`) contains special tests that validate README examples:

- Tests are linked to README code blocks via `#DOC_TEST_XX` identifiers
- All React state updates in tests must be wrapped in `act()` to prevent warnings
- Tests run in browser environment using Vitest + Playwright

## Key Guidelines

1. **Always run tests and typecheck** - Both must pass after any changes
2. **Maintain documentation consistency** - README examples must match test implementations
3. **Use proper React testing patterns** - Wrap state updates in `act()`
4. **Follow TypeScript best practices** - All code must be properly typed
5. **Preserve fine-grained reactivity** - Ensure changes don't break reactive behavior

## Common Issues

- **React act() warnings**: Wrap store updates in tests with `act(() => { update(...) })`
- **Type errors**: Run `pnpm run typecheck` to catch TypeScript issues early
- **Documentation test failures**: Ensure README examples match test expectations
- **Module resolution**: Use proper imports and check package.json exports

## Package Manager

This project uses **pnpm** with workspace support. Always use `pnpm` instead of `npm` or `yarn`.
