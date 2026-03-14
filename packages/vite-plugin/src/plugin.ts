import type { Plugin } from 'vite'
import ts from 'typescript'
import MagicString from 'magic-string'
import path from 'path'

function hasBrand(type: ts.Type): boolean {
  for (const prop of type.getProperties()) {
    const name = prop.getName()
    if (name.includes('supergrain:brand')) return true
  }
  return false
}

function isWriteTarget(node: ts.PropertyAccessExpression): boolean {
  const parent = node.parent
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  ) {
    return true
  }
  // Also skip compound assignments (+=, -=, etc.)
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment &&
    parent.left === node
  ) {
    return true
  }
  // Skip delete expressions
  if (ts.isDeleteExpression(parent)) return true
  // Skip prefix/postfix unary (++/--)
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return true
  return false
}

export function transformCode(
  code: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): { code: string; map: any } | null {
  const s = new MagicString(code)

  // Collect all candidate rewrites first, then filter overlaps
  const rewrites: { start: number; end: number; replacement: string }[] = []

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      // Skip writes
      if (isWriteTarget(node)) {
        ts.forEachChild(node, visit)
        return
      }
      // Skip method calls (store.items.map, store.items.push, etc.)
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
        ts.forEachChild(node, visit)
        return
      }

      const exprType = checker.getTypeAtLocation(node.expression)
      if (hasBrand(exprType)) {
        const start = node.getStart(sourceFile)
        const end = node.getEnd()
        const exprStart = node.expression.getStart(sourceFile)
        const exprEnd = node.expression.getEnd()
        const exprText = code.slice(exprStart, exprEnd)
        const propName = node.name.getText(sourceFile)

        rewrites.push({ start, end, replacement: `readSignal(${exprText}, '${propName}')()` })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  // Filter out rewrites that are contained within a larger rewrite
  // Sort by start position descending so we apply from end of file backwards
  // (avoids offset issues). Also remove any rewrite whose range is fully
  // contained within another rewrite's range.
  const filtered = rewrites.filter((r) => {
    return !rewrites.some(
      (other) => other !== r && other.start <= r.start && other.end >= r.end
    )
  })

  // Sort by start descending so overwrites don't shift positions
  filtered.sort((a, b) => b.start - a.start)

  for (const r of filtered) {
    s.overwrite(r.start, r.end, r.replacement)
  }

  const hasRewrites = filtered.length > 0

  if (!hasRewrites) return null

  // Add import if not already present
  if (!code.includes("from '@supergrain/core'") && !code.includes('from "@supergrain/core"')) {
    s.prepend("import { readSignal } from '@supergrain/core';\n")
  } else if (!code.includes('readSignal')) {
    // Has core import but no readSignal — need to add it
    const importMatch = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]@supergrain\/core['"]/)
    if (importMatch) {
      const importStart = code.indexOf(importMatch[0])
      const importEnd = importStart + importMatch[0].length
      const existingImports = importMatch[1]
      s.overwrite(importStart, importEnd, `import {${existingImports}, readSignal } from '@supergrain/core'`)
    }
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}

/**
 * Vite plugin that compiles branded store property reads into direct signal access.
 *
 * NOTE: The TypeScript program is created once at startup. During `vite dev`,
 * files added or changed after startup won't be compiled. This works correctly
 * for production builds. Dev mode incremental compilation requires a
 * LanguageService-based approach (planned for a future release).
 */
export function supergrain(): Plugin {
  let program: ts.Program | null = null
  let checker: ts.TypeChecker | null = null

  return {
    name: 'supergrain',
    enforce: 'pre',

    configResolved(config) {
      const rootDir = config.root || process.cwd()
      const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
      if (!configPath) return
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      )
      program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options)
      checker = program.getTypeChecker()
    },

    transform(code, id) {
      if (!checker || !program) return null
      if (!/\.[tj]sx?$/.test(id)) return null
      if (id.includes('node_modules')) return null

      const sourceFile = program.getSourceFile(id)
      if (!sourceFile) return null

      return transformCode(code, sourceFile, checker)
    },
  }
}
