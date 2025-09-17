# Storable Repository - GitHub Copilot Instructions

**CRITICAL**: Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

Storable is a reactive store library with fine-grained reactivity powered by alien-signals. The project uses pnpm workspaces with multiple packages for core reactive functionality, React integration, app-level document management, and comprehensive documentation testing.

## Working Effectively

### Initial Setup and Dependencies
- **NEVER use npm or yarn**: This project exclusively uses `pnpm@10.6.3` for package management
- Install pnpm globally: `npm install -g pnpm@10.6.3`
- Install all dependencies: `pnpm install --frozen-lockfile` (takes ~20 seconds)
- Approve build scripts if prompted: Select `esbuild` and approve when prompted

### Building the Project
- **Build all packages**: `pnpm -r --filter="@storable/core" --filter="@storable/react" --filter="@storable/app-store" build`
- **Build timing**: Total ~20 seconds (core: 3s, react: 10s, app-store: 9s). NEVER CANCEL - set timeout to 60+ seconds
- **Individual package builds**: 
  - Core: `cd packages/core && pnpm build`
  - React: `cd packages/react && pnpm build` 
  - App Store: `cd packages/app-store && pnpm build`

### Testing Strategy
- **Run all tests**: `pnpm test` (NOTE: Requires Playwright browsers - see Browser Setup section)
- **Core tests only**: `cd packages/core && pnpm test` (takes ~2 seconds, works without browser setup)
- **Type checking**: `pnpm run typecheck` (takes ~14 seconds across all packages)
- **Documentation validation**: `pnpm run test:validate` (takes ~1.6 seconds)
- **NEVER CANCEL builds or tests** - They complete quickly. Set timeouts to 120+ seconds for safety

### Browser Setup for React Tests
- **Required for React/browser tests**: `pnpm exec playwright install`
- **If browser installation fails**: Run core tests only with `cd packages/core && pnpm test`
- **React tests require**: Chromium browser via Playwright for Vitest browser testing

### Performance Benchmarking
- **Core benchmarks**: `pnpm bench:core` (takes ~41 seconds, includes solid-js comparisons)
- **Individual package benchmarks**: `cd packages/core && pnpm bench:core`
- **NEVER CANCEL benchmarks** - They provide critical performance validation. Set timeout to 180+ seconds

## Validation Requirements

### After Making Code Changes - MANDATORY SEQUENCE
1. **Lint code**: `pnpm -r run lint` (takes ~1 second, shows warnings but exits 0)
2. **Run tests**: `pnpm test` OR `cd packages/core && pnpm test` if browser setup unavailable
3. **Type check**: `pnpm run typecheck` (takes ~14 seconds - CRITICAL for TypeScript validation)
4. **Validate documentation**: `pnpm run test:validate` (takes ~1.6 seconds)

### Critical Validation Notes
- **Linting shows warnings**: This is normal - the build passes with warnings about unused variables
- **Documentation tests**: All README code blocks must have `#DOC_TEST_XX` identifiers and corresponding tests
- **React tests require browsers**: If Playwright setup fails, validate with core tests only
- **Always wrap React state updates in tests with `act()`** to prevent warnings

## Package Structure and Key Locations

### Core Packages
- **`@storable/core`** (packages/core/): Core reactive store implementation with alien-signals
- **`@storable/react`** (packages/react/): React hooks and integration layer  
- **`@storable/app-store`** (packages/app-store/): Document-oriented store for app-level state
- **`@storable/documentation`** (packages/documentation/): Documentation validation tests

### Additional Packages
- **`@storable/react-example`** (packages/react-example/): Example React application (`pnpm dev` to run)
- **`js-framework-benchmark-react-storable`** (packages/js-krauset/): Performance benchmarks
- **`packages/comparisons`**: Comparison utilities and benchmarks

### Important Files
- **Root package.json**: Main project scripts and dependencies
- **pnpm-workspace.yaml**: Workspace configuration
- **AGENTS.md**: AI agent instructions (existing documentation)
- **CLAUDE.md**: Claude-specific instructions (existing documentation)
- **README.md**: Main project documentation with DOC_TEST examples

## Running Applications

### React Example App
- **Start development server**: `cd packages/react-example && pnpm dev`
- **URL**: http://localhost:5173/ (starts in ~268ms)
- **Building**: `cd packages/react-example && pnpm build`

### Development Workflow
- **Watch mode builds**: Use `pnpm dev` in individual packages for auto-rebuild
- **Test watch mode**: Use `pnpm test:watch` in packages for continuous testing

## Documentation Requirements

### DOC_TEST System
- **Every TypeScript code block in README.md must have a unique `#DOC_TEST_XX` identifier**
- **Each identifier must map to exactly one test case** in packages/documentation/tests/
- **Validation command**: `pnpm run test:validate` ensures all DOC_TEST identifiers have tests
- **Test locations**:
  - Core examples: `packages/documentation/tests/readme-core.test.ts`
  - React examples: `packages/documentation/tests/readme-react.test.tsx`  
  - Complex examples: `packages/documentation/tests/readme-examples.test.tsx`

### Adding New Documentation Tests
1. Add `// [#DOC_TEST_XX](packages/documentation/tests/appropriate-test-file.ts)` to README code block
2. Create corresponding test: `it('#DOC_TEST_XX', () => { /* implementation */ })`
3. Run `pnpm test:validate` to ensure proper linking

## Common Development Tasks

### Debugging and Investigation
- **Check existing DOC_TEST numbers**: `grep -o "DOC_TEST_[0-9]*" README.md | sed 's/DOC_TEST_//' | sort -n | tail -1`
- **View package structure**: All packages have consistent structure with src/, tests/, and package.json
- **Configuration files**: Each package has individual vite.config.ts, tsconfig.json for build configuration

### Repository Navigation
- **Main source code**: packages/*/src/
- **Tests**: packages/*/tests/ and packages/*/src/*.test.ts
- **Benchmarks**: packages/core/benchmarks/
- **Examples**: packages/react/examples/ and packages/react-example/src/
- **Documentation**: Root README.md, packages/documentation/tests/

## Timing Expectations and Timeouts

### Build Times (NEVER CANCEL)
- **pnpm install**: ~20 seconds - Set timeout to 60+ seconds
- **Full build**: ~20 seconds total - Set timeout to 60+ seconds  
- **Individual builds**: 3-10 seconds each - Set timeout to 30+ seconds

### Test Times (NEVER CANCEL)  
- **Core tests**: ~2 seconds - Set timeout to 30+ seconds
- **Type checking**: ~14 seconds - Set timeout to 60+ seconds
- **Documentation validation**: ~1.6 seconds - Set timeout to 30+ seconds
- **Benchmarks**: ~41 seconds - Set timeout to 180+ seconds

### Dependency Installation
- **Playwright browsers**: Can take 5+ minutes and may fail - Document as optional for React tests
- **Regular packages**: ~20 seconds for frozen lockfile install

## Troubleshooting Common Issues

### Build Failures
- **Missing @vitejs/plugin-react**: Run `pnpm add -D @vitejs/plugin-react` in root if needed
- **Build scripts approval**: Approve esbuild when prompted during first install
- **Node version**: Tested with Node.js v20.19.5, should work with Node 18+ 

### Test Failures
- **Playwright browser missing**: Install with `pnpm exec playwright install` or run core tests only
- **React act() warnings**: Wrap store updates in tests with `act(() => { /* update */ })`
- **Module resolution errors**: Check workspace dependencies in package.json files

### Performance
- **Benchmark comparison failures**: Some solid-js comparisons may show "NaN" - this is expected for certain operations
- **Memory issues**: Run benchmarks individually if full suite fails

## CI/CD Pipeline
The GitHub Actions CI (`.github/workflows/ci.yml`) runs:
1. **Build**: `pnpm -r --filter="@storable/core" --filter="@storable/react" --filter="@storable/app-store" build`
2. **Test**: `pnpm test` (with Playwright in container)
3. **Documentation validation**: `pnpm run test:validate`  
4. **Type checking**: `pnpm run typecheck`

**Critical**: Always run these same commands locally before pushing to ensure CI success.