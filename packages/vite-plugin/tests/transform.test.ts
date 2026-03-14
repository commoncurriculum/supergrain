import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { transformCode } from '../src/plugin'

function createTestProgram(code: string): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  // Write temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supergrain-test-'))
  const filePath = path.join(tmpDir, 'test.ts')
  fs.writeFileSync(filePath, code)

  // Find @supergrain/core types
  const coreTypesDir = path.resolve(__dirname, '../../core')

  const program = ts.createProgram([filePath], {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: {
      '@supergrain/core': [path.join(coreTypesDir, 'src/index.ts')],
    },
    baseUrl: tmpDir,
  })

  const sourceFile = program.getSourceFile(filePath)!
  const checker = program.getTypeChecker()

  return { sourceFile, checker }
}

describe('supergrain vite plugin: transform', () => {
  it('compiles branded property read to readSignal', () => {
    const code = `
import { createStore } from '@supergrain/core'
const [store] = createStore({ title: 'hello' })
const x = store.title
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    expect(result).not.toBeNull()
    expect(result!.code).toContain("readSignal(store, 'title')")
    expect(result!.code).toContain('readSignal')
    expect(result!.code).toContain("@supergrain/core")
  })

  it('compiles nested property access', () => {
    const code = `
import { createStore } from '@supergrain/core'
const [store] = createStore({ assignee: { name: 'Scott' } })
const x = store.assignee.name
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    expect(result).not.toBeNull()
    expect(result!.code).toContain("readSignal(readSignal(store, 'assignee'), 'name')")
  })

  it('does NOT compile writes (assignment)', () => {
    const code = `
import { createStore } from '@supergrain/core'
const [store] = createStore({ title: 'hello' })
store.title = 'world'
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    // The write should be left alone. If there are no reads, result might be null.
    if (result) {
      expect(result.code).toContain("store.title = 'world'")
    }
  })

  it('does NOT compile plain object reads', () => {
    const code = `
const plain = { name: 'hello' }
const x = plain.name
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    expect(result).toBeNull()
  })

  it('does NOT compile method calls', () => {
    const code = `
import { createStore } from '@supergrain/core'
const [store] = createStore({ items: [1, 2, 3] })
store.items.map(x => x)
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    // .map is a method call — should not be compiled
    if (result) {
      expect(result.code).not.toContain("readSignal(store.items, 'map')")
    }
  })

  it('adds readSignal to existing @supergrain/core import', () => {
    const code = `
import { createStore } from '@supergrain/core'
const [store] = createStore({ title: 'hello' })
const x = store.title
`
    const { sourceFile, checker } = createTestProgram(code)
    const result = transformCode(code, sourceFile, checker)
    expect(result).not.toBeNull()
    // Should modify existing import, not add duplicate
    expect(result!.code).toContain('readSignal')
    // Should not have two separate @supergrain/core imports
    const importCount = (result!.code.match(/@supergrain\/core/g) || []).length
    expect(importCount).toBe(1)
  })
})
