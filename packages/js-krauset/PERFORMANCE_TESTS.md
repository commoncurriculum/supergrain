# Krauset Performance Tests

This directory contains performance tests for the Krauset benchmark suite, measuring the core operations of the React application using the Storable library.

## Overview

The performance tests measure the same core behaviors as the original js-framework-benchmark Krauset test:

- **Creating 1K rows** - Initial render performance with 1,000 items
- **Creating 10K rows** - Initial render performance with 10,000 items
- **Updating** - Updating every 10th row (100 out of 1,000 rows)
- **Swapping** - Swapping two specific rows (row 1 and row 998)
- **Selecting** - Selecting a single row and highlighting it

## Files

- `src/performance.test.tsx` - Vitest-based test suite with detailed console logging
- `src/performance.script.tsx` - Standalone performance script (can be used independently)
- `performance.html` - Browser-based performance test runner with UI
- `vitest.config.ts` - Vitest configuration for the test environment

## Running the Tests

### Option 1: Run via npm/pnpm (Recommended)

```bash
# Run all performance tests
pnpm test:performance

# Run all tests (including performance tests)
pnpm test
```

### Option 2: Run individual tests with Vitest

```bash
# Run only the complete performance suite test
pnpm vitest src/performance.test.tsx -t "should run complete performance suite"

# Run a specific test (e.g., 1K rows creation)
pnpm vitest src/performance.test.tsx -t "should measure creating 1K rows"
```

### Option 3: Browser-based testing

1. Build the project: `pnpm build-prod`
2. Open `performance.html` in your browser
3. Click "Run Performance Tests" button

## Test Results

The tests output detailed performance metrics to the console, including:

- Individual operation timing (in milliseconds)
- Verification that operations completed successfully
- Summary statistics (total time, average per operation)

### Sample Output

```
🚀 KRAUSET PERFORMANCE SUITE RESULTS 🚀
==========================================
Creating 1K rows: 60.80ms
Selecting row: 32.10ms
Updating every 10th row: 34.00ms
Swapping rows: 39.50ms
Creating 10K rows: 680.70ms

📊 PERFORMANCE SUMMARY
=====================
Create 1K rows:     60.80ms
Create 10K rows:    680.70ms
Select row:         32.10ms
Update (every 10th): 34.00ms
Swap 2 rows:        39.50ms
=====================
Total time:         847.10ms
Average per op:     169.42ms
```

## Implementation Details

### Component Usage

The tests use the exact same components from `main.tsx`:

- `Row` component (memoized with React.memo)
- `App` component (using `<For>` component for rendering)
- Same data generation logic and store operations

### Performance Measurement

- Uses `performance.now()` for high-precision timing
- Runs in real Chromium browser via Vitest browser mode (not jsdom)
- Includes proper React rendering synchronization with DOM updates
- Verifies that operations completed successfully
- Measures full render cycle including DOM manipulation

### Optimization Features Tested

The tests validate the performance benefits of:

- **React.memo optimization** - Only changed rows re-render
- **Stable callback references** - Prevents unnecessary re-renders
- **Proxy reference stability** - Enables effective memoization
- **For component efficiency** - Optimized list rendering

## Expected Performance

With the Storable library optimizations in a real browser, you should see:

- **Creating 1K rows**: ~50-80ms (initial DOM creation)
- **Creating 10K rows**: ~500-800ms (large DOM creation)
- **Selecting**: ~25-35ms (only 1 row re-renders, but includes DOM updates)
- **Updating**: ~30-40ms (only changed rows re-render)
- **Swapping**: ~40-60ms (only 2 rows re-render)

These numbers reflect real browser performance including DOM manipulation.
Poor performance (>2x these numbers) would indicate optimization issues.

## Customization

You can modify the tests by:

1. Adjusting data sizes in `buildData(count)` calls
2. Changing which rows are updated/swapped
3. Adding new test scenarios
4. Modifying timing measurement precision

## Troubleshooting

### Tests fail to run

- Ensure `pnpm install` has been run
- Check that Vitest browser dependencies (@vitest/browser, playwright) are installed
- Verify Playwright browsers are installed: `npx playwright install`
- Verify the project builds successfully

### Inconsistent results

- Run tests multiple times (performance can vary)
- Ensure no other heavy processes are running
- Results may vary between different browsers/environments

### Poor performance

- Check that React.memo is working (compare with unmemoized version)
- Verify stable callback references are used
- Ensure the For component is properly handling version props

## Integration with Benchmarking Tools

These tests are designed to complement formal benchmarking tools:

- Output can be parsed for CI/CD performance monitoring
- Results format is compatible with performance tracking systems
- Can be extended to generate JSON reports for analysis tools
