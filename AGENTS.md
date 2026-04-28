# Agent Instructions

This document provides instructions for AI agents working in this repository.

## Package Manager

This project uses `pnpm` for package management. Do not use `npm` or `yarn`. All package installation, removal, or script execution should be done using `pnpm`.

**Examples:**

- `pnpm install`
- `pnpm add <package-name>`
- `pnpm run <script-name>`

## Pre-Push Verification

Before committing or pushing changes, run the same checks as CI when feasible:

- `pnpm run format:check`
- `pnpm run lint`
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm run coverage` or `pnpm test`
- `pnpm run test:validate` when README/docs examples changed

If you intentionally skip any check, mention it in the final response with the reason.

## Documentation Test Requirements

### DOC_TEST Identifiers

Each TypeScript code block in the README.md must have a unique `DOC_TEST_` identifier and a corresponding test:

1. **Unique Identifiers**: Each code block must use a unique identifier like `// [#DOC_TEST_1]`, `// [#DOC_TEST_2]`, etc.
2. **One-to-One Mapping**: Each `DOC_TEST_` identifier in README.md must map to exactly one test case in the documentation package.
3. **Sequential Numbering**: Use the next available number when adding new DOC_TEST identifiers. Check existing numbers with:
   ```bash
   grep -o "DOC_TEST_[0-9]*" README.md | sed 's/DOC_TEST_//' | sort -n | tail -1
   ```

### Adding New Documentation Tests

When adding a new code example to README.md:

1. **Add the identifier**: Include `// [#DOC_TEST_XX](packages/documentation/tests/appropriate-test-file.ts)` at the top of the code block
2. **Create the test**: Add a corresponding test case in the appropriate test file:
   ```typescript
   it("#DOC_TEST_XX", () => {
     // Test implementation that matches the README example
   });
   ```
3. **Validate**: Run `pnpm test:validate` to ensure all DOC_TEST identifiers have corresponding tests

### Validation Commands

- **Documentation validation**: `pnpm test:validate` - Checks that all README code blocks have DOC_TEST identifiers and corresponding tests
- **Type checking**: `pnpm run typecheck` - Validates TypeScript types across all packages
- **Full test suite**: `pnpm test` - Runs all tests (requires Playwright for browser tests)

### Test File Locations

- Core functionality examples: `packages/documentation/tests/readme-core.test.ts`
- React integration examples: `packages/documentation/tests/readme-react.test.tsx`
- Complex examples: `packages/documentation/tests/readme-examples.test.tsx`
- App Store examples: Tests are typically in `readme-examples.test.tsx`
