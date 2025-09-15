/**
 * README Documentation Validation Tests
 *
 * Tests that ensure:
 * - All code blocks in README.md have DOC_TEST identifiers
 * - All DOC_TEST identifiers have corresponding tests in the test suite
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

describe('README Documentation Validation', () => {
  const readmeContent = readFileSync(
    join(__dirname, '../../../README.md'),
    'utf-8'
  )

  const testsDir = __dirname
  const testFiles = readdirSync(testsDir)
    .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.tsx'))
    .filter(file => file !== 'readme-validation.test.ts') // Exclude self

  it('should have DOC_TEST identifiers in all TypeScript code blocks', () => {
    // Extract all TypeScript code blocks from README
    const codeBlockRegex = /```typescript\s*([\s\S]*?)```/g
    const codeBlocks: string[] = []
    let match

    while ((match = codeBlockRegex.exec(readmeContent)) !== null) {
      codeBlocks.push(match[1])
    }

    expect(codeBlocks.length).toBeGreaterThan(0)

    // Check each code block for DOC_TEST identifier
    const missingIdentifiers: { index: number; preview: string }[] = []

    codeBlocks.forEach((block, index) => {
      const trimmedBlock = block.trim()

      // Look for DOC_TEST identifier in the block (flexible format after DOC_TEST_)
      const hasDocTest = /\/\/\s*\[#DOC_TEST_[A-Za-z0-9_]+\]/.test(block)

      if (!hasDocTest) {
        const preview =
          trimmedBlock.split('\n')[0].substring(0, 60) +
          (trimmedBlock.length > 60 ? '...' : '')
        missingIdentifiers.push({ index: index + 1, preview })
      }
    })

    if (missingIdentifiers.length > 0) {
      const details = missingIdentifiers
        .map(({ index, preview }) => `  Block ${index}: "${preview}"`)
        .join('\n')
      throw new Error(`Code blocks missing DOC_TEST identifiers:\n${details}`)
    }
  })

  it('should have corresponding tests for all DOC_TEST identifiers in README', () => {
    // Extract all DOC_TEST identifiers from README (flexible format)
    const docTestRegex = /\/\/\s*\[#(DOC_TEST_[A-Za-z0-9_]+)\]/g
    const docTestIds = new Set<string>()
    let match

    while ((match = docTestRegex.exec(readmeContent)) !== null) {
      docTestIds.add(match[1])
    }

    expect(docTestIds.size).toBeGreaterThan(0)

    // Read all test files and extract their DOC_TEST test cases
    const implementedTests = new Set<string>()

    testFiles.forEach(testFile => {
      const testContent = readFileSync(join(testsDir, testFile), 'utf-8')

      // Look for test cases with DOC_TEST identifiers (flexible format)
      const testCaseRegex = /it\s*\(\s*['"`]#(DOC_TEST_[A-Za-z0-9_]+)['"`]/g
      let testMatch

      while ((testMatch = testCaseRegex.exec(testContent)) !== null) {
        implementedTests.add(testMatch[1])
      }
    })

    // Find missing tests
    const missingTests: string[] = []
    docTestIds.forEach(docTestId => {
      if (!implementedTests.has(docTestId)) {
        missingTests.push(docTestId)
      }
    })

    if (missingTests.length > 0) {
      throw new Error(
        `Missing tests for DOC_TEST identifiers: ${missingTests.join(', ')}`
      )
    }
  })

  it('should not have orphaned test cases (tests without corresponding README examples)', () => {
    // Extract all DOC_TEST identifiers from README
    const docTestRegex = /\/\/\s*\[#(DOC_TEST_[A-Za-z0-9_]+)\]/g
    const readmeDocTests = new Set<string>()
    let match

    while ((match = docTestRegex.exec(readmeContent)) !== null) {
      readmeDocTests.add(match[1])
    }

    // Read all test files and extract their DOC_TEST test cases
    const testCaseDocTests = new Set<string>()

    testFiles.forEach(testFile => {
      const testContent = readFileSync(join(testsDir, testFile), 'utf-8')

      // Look for test cases with DOC_TEST identifiers
      const testCaseRegex = /it\s*\(\s*['"`]#(DOC_TEST_[A-Za-z0-9_]+)['"`]/g
      let testMatch

      while ((testMatch = testCaseRegex.exec(testContent)) !== null) {
        testCaseDocTests.add(testMatch[1])
      }
    })

    // Find orphaned tests (tests that don't have corresponding README examples)
    const orphanedTests: string[] = []
    testCaseDocTests.forEach(testId => {
      if (!readmeDocTests.has(testId)) {
        orphanedTests.push(testId)
      }
    })

    if (orphanedTests.length > 0) {
      throw new Error(
        `Orphaned test cases (no corresponding README examples): ${orphanedTests.join(
          ', '
        )}`
      )
    }
  })

  it('should have unique DOC_TEST identifiers in README', () => {
    const docTestRegex = /\/\/\s*\[#(DOC_TEST_[A-Za-z0-9_]+)\]/g
    const docTestIds: string[] = []
    let match

    while ((match = docTestRegex.exec(readmeContent)) !== null) {
      docTestIds.push(match[1])
    }

    const uniqueIds = new Set(docTestIds)

    if (docTestIds.length !== uniqueIds.size) {
      // Find duplicates
      const duplicates = docTestIds.filter(
        (id, index) => docTestIds.indexOf(id) !== index
      )

      throw new Error(
        `Duplicate DOC_TEST identifiers found: ${[...new Set(duplicates)].join(
          ', '
        )}`
      )
    }
  })

  it('should have unique DOC_TEST identifiers in test files', () => {
    const allTestIds: string[] = []

    testFiles.forEach(testFile => {
      const testContent = readFileSync(join(testsDir, testFile), 'utf-8')

      // Look for test cases with DOC_TEST identifiers
      const testCaseRegex = /it\s*\(\s*['"`]#(DOC_TEST_[A-Za-z0-9_]+)['"`]/g
      let testMatch

      while ((testMatch = testCaseRegex.exec(testContent)) !== null) {
        allTestIds.push(`${testMatch[1]} (in ${testFile})`)
      }
    })

    const testIdCounts = new Map<string, string[]>()
    allTestIds.forEach(testIdWithFile => {
      const [testId, fileInfo] = testIdWithFile.split(' (in ')
      if (!testIdCounts.has(testId)) {
        testIdCounts.set(testId, [])
      }
      testIdCounts.get(testId)!.push(fileInfo.replace(')', ''))
    })

    const duplicates = Array.from(testIdCounts.entries())
      .filter(([_, files]) => files.length > 1)
      .map(([testId, files]) => `${testId} (in ${files.join(', ')})`)

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate DOC_TEST identifiers in test files: ${duplicates.join(', ')}`
      )
    }
  })
})
