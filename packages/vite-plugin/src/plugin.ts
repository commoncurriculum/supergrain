import type { Plugin } from 'vite'
import ts from 'typescript'
import MagicString from 'magic-string'
import path from 'path'

function hasBrand(type: ts.Type): boolean {
  for (const prop of type.getProperties()) {
    const name = prop.getName()
    // Match both the Symbol.for name and the TS internal representation
    // TS may represent Symbol.for('supergrain:brand') as either:
    //   - "__@$BRAND@NNNN" (unique symbol internal name)
    //   - containing "supergrain:brand" (when resolved through Symbol.for)
    if (name.includes('supergrain:brand') || name.includes('$BRAND')) return true
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

  // Track write context depth — when > 0, we're inside the LHS of an assignment
  // and should not transform any reads (they feed into a mutation path).
  let inWriteContext = 0

  // Track nodes that should be skipped (e.g., receiver of a method call)
  const skipNodes = new Set<ts.Node>()

  // Build a fully nested readSignal expression for a property access chain.
  // e.g. store.user.address.city → readSignal(readSignal(readSignal(store, 'user'), 'address'), 'city')
  function buildReadExpr(node: ts.PropertyAccessExpression): string {
    const propName = node.name.getText(sourceFile)
    const expr = node.expression

    // If the expression is also a branded property access, recurse
    if (ts.isPropertyAccessExpression(expr) && !skipNodes.has(expr)) {
      const exprType = checker.getTypeAtLocation(expr.expression)
      if (hasBrand(exprType)) {
        return `readSignal(${buildReadExpr(expr)}, '${propName}')`
      }
    }

    // Base case: expression is not a branded property access (identifier, call, bracket, etc.)
    const exprStart = expr.getStart(sourceFile)
    const exprEnd = expr.getEnd()
    const exprText = code.slice(exprStart, exprEnd)
    return `readSignal(${exprText}, '${propName}')`
  }

  // Collect outermost rewrites only — each builds the full nested expression
  const rewrites: { start: number; end: number; replacement: string }[] = []
  const compiledNodes = new Set<ts.Node>()

  function visit(node: ts.Node) {
    // Detect if this node is the LHS of an assignment — everything below is write context
    let startedWriteContext = false
    if (node.parent && ts.isBinaryExpression(node.parent)) {
      const opKind = node.parent.operatorToken.kind
      const isAssignment =
        opKind === ts.SyntaxKind.EqualsToken ||
        (opKind >= ts.SyntaxKind.FirstCompoundAssignment &&
          opKind <= ts.SyntaxKind.LastCompoundAssignment)
      if (isAssignment && node.parent.left === node) {
        inWriteContext++
        startedWriteContext = true
      }
    }
    // delete expression: the operand is a write target
    if (node.parent && ts.isDeleteExpression(node.parent) && node.parent.expression === node) {
      inWriteContext++
      startedWriteContext = true
    }
    // prefix/postfix unary (++/--): the operand is a write target
    if (node.parent && (ts.isPrefixUnaryExpression(node.parent) || ts.isPostfixUnaryExpression(node.parent))) {
      inWriteContext++
      startedWriteContext = true
    }

    if (ts.isPropertyAccessExpression(node)) {
      // Skip if this node was marked (e.g., receiver of a method call like store.data in store.data.push())
      if (skipNodes.has(node)) {
        ts.forEachChild(node, visit)
        if (startedWriteContext) inWriteContext--
        return
      }

      // Skip method calls AND mark the receiver expression as skip.
      // For store.data.push(): the callee is store.data.push (a PropertyAccessExpression).
      // We skip the callee itself, and also mark store.data (its .expression) as skip
      // so it won't be transformed — push() needs the proxy, not the raw array.
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
        skipNodes.add(node.expression)
        ts.forEachChild(node, visit)
        if (startedWriteContext) inWriteContext--
        return
      }

      // Only transform in pure read context (not inside LHS of assignments)
      // Only transform outermost — skip if parent already compiled this node
      if (inWriteContext === 0 && !compiledNodes.has(node)) {
        const exprType = checker.getTypeAtLocation(node.expression)
        if (hasBrand(exprType)) {
          const start = node.getStart(sourceFile)
          const end = node.getEnd()
          const replacement = buildReadExpr(node)

          rewrites.push({ start, end, replacement })

          // Mark all inner property access nodes as compiled so they don't generate separate rewrites.
          // Walk through all expression wrappers (NonNull, ElementAccess, Parenthesized, etc.)
          function markInner(n: ts.Node) {
            if (ts.isPropertyAccessExpression(n)) {
              compiledNodes.add(n)
              markInner(n.expression)
            } else if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) {
              markInner(n.expression)
            } else if (ts.isElementAccessExpression(n)) {
              markInner(n.expression)
            }
          }
          markInner(node.expression)
        }
      }
    }
    ts.forEachChild(node, visit)
    if (startedWriteContext) inWriteContext--
  }

  visit(sourceFile)

  // Sort by start descending so overwrites don't shift positions
  rewrites.sort((a, b) => b.start - a.start)

  for (const r of rewrites) {
    s.overwrite(r.start, r.end, r.replacement)
  }

  const hasRewrites = rewrites.length > 0

  if (!hasRewrites) return null

  // Add readSignal import — find the import that provides createStore
  // (could be '@supergrain/core', '../src', or any path)
  if (!code.includes('readSignal')) {
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])/g
    let importMatch: RegExpExecArray | null
    let found = false
    while ((importMatch = importRegex.exec(code)) !== null) {
      if (importMatch[1].includes('createStore')) {
        const importStart = importMatch.index
        const importEnd = importStart + importMatch[0].length
        const existingImports = importMatch[1]
        const source = importMatch[2]
        s.overwrite(importStart, importEnd, `import {${existingImports}, readSignal } from ${source}`)
        found = true
        break
      }
    }
    if (!found) {
      s.prepend("import { readSignal } from '@supergrain/core';\n")
    }
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}

function createInMemoryHost(
  fileContents: Map<string, string>,
  options: ts.CompilerOptions
): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost(options)
  return {
    ...defaultHost,
    getSourceFile(fileName, languageVersion, onError) {
      const content = fileContents.get(fileName)
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true)
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError)
    },
    fileExists(fileName) {
      return fileContents.has(fileName) || defaultHost.fileExists(fileName)
    },
    readFile(fileName) {
      return fileContents.get(fileName) ?? defaultHost.readFile(fileName)
    },
  }
}

/**
 * Vite plugin that compiles branded store property reads into direct signal access.
 *
 * Creates a fresh TypeScript program per transform call with an in-memory
 * compiler host, so the program always sees the current file content from Vite
 * regardless of path aliases or resolution differences.
 */
export function supergrain(): Plugin {
  let compilerOptions: ts.CompilerOptions = {}
  let baseFileNames: string[] = []

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
      compilerOptions = parsedConfig.options
      baseFileNames = parsedConfig.fileNames

      // Translate Vite resolve.alias into TypeScript paths so the TS program
      // can resolve aliased modules (e.g. @supergrain/core) to their source files.
      const alias = config.resolve?.alias
      if (alias) {
        if (!compilerOptions.baseUrl) {
          compilerOptions.baseUrl = rootDir
        }
        const paths: Record<string, string[]> = { ...(compilerOptions.paths || {}) }

        const entries: Array<{ find: string; replacement: string }> = []
        if (Array.isArray(alias)) {
          for (const entry of alias) {
            if (typeof entry.find === 'string' && typeof entry.replacement === 'string') {
              entries.push({ find: entry.find, replacement: entry.replacement })
            }
          }
        } else if (typeof alias === 'object') {
          for (const [key, value] of Object.entries(alias)) {
            if (typeof value === 'string') {
              entries.push({ find: key, replacement: value })
            }
          }
        }

        for (const { find, replacement } of entries) {
          const isFile = /\.[tj]sx?$/.test(replacement)
          // Exact match: point directly to the replacement
          paths[find] = [replacement]
          // Wildcard match: for directory aliases, allow deep imports
          if (!isFile) {
            paths[`${find}/*`] = [`${replacement}/*`]
          }
        }

        compilerOptions.paths = paths
      }
    },

    transform(code, id) {
      if (!/\.[tj]sx?$/.test(id)) return null
      if (id.includes('node_modules')) return null

      // Create a program that includes this specific file with its current content
      const fileContents = new Map<string, string>()
      fileContents.set(id, code)

      const fileNames = baseFileNames.includes(id) ? baseFileNames : [id, ...baseFileNames]
      const host = createInMemoryHost(fileContents, compilerOptions)
      const program = ts.createProgram(fileNames, compilerOptions, host)
      const checker = program.getTypeChecker()
      const sourceFile = program.getSourceFile(id)

      if (!sourceFile) return null

      return transformCode(code, sourceFile, checker)
    },
  }
}
