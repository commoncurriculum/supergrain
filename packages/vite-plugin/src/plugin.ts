import type { Plugin } from 'vite'
import ts from 'typescript'
import MagicString from 'magic-string'
import path from 'path'

export function transformCode(
  code: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): { code: string; map: any } | null {
  const s = new MagicString(code)

  const rewrites: { start: number; end: number; replacement: string }[] = []

  // --- $$ transformation pass ---
  interface DollarDollarBinding {
    // The $$(expr) CallExpression node
    callNode: ts.CallExpression
    // The inner expression text (what's inside $$())
    innerExprText: string
    // 'text' or 'attribute'
    position: 'text' | 'attribute'
    // For attribute position, the attribute name (e.g. 'className')
    attrName?: string
    // The JSX opening element (or self-closing) where ref should be added
    targetElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement
    // The component function body where refs/hook should be inserted
    componentBody: ts.Block
    // Unique index for this binding
    index: number
  }

  const ddBindings: DollarDollarBinding[] = []
  let ddIndex = 0

  function findEnclosingComponent(node: ts.Node): ts.Block | null {
    let current: ts.Node | undefined = node.parent
    while (current) {
      if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
        const body = current.body
        if (body && ts.isBlock(body)) {
          return body
        }
        return null
      }
      current = current.parent
    }
    return null
  }

  function findParentJsxElement(node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
    let current: ts.Node | undefined = node.parent
    while (current) {
      if (ts.isJsxElement(current)) {
        return current.openingElement
      }
      if (ts.isJsxSelfClosingElement(current)) {
        return current
      }
      if (ts.isJsxFragment(current)) {
        return null // Can't attach ref to a fragment
      }
      current = current.parent
    }
    return null
  }

  function visitDD(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === '$$' &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0]
      const innerText = code.slice(arg.getStart(sourceFile), arg.getEnd())

      // Determine position: check parent chain
      const parent = node.parent
      if (parent && ts.isJsxExpression(parent)) {
        const grandparent = parent.parent
        if (grandparent && ts.isJsxAttribute(grandparent)) {
          // Attribute position
          const attrName = grandparent.name.getText(sourceFile)
          // JsxAttribute -> JsxAttributes -> JsxOpeningElement/JsxSelfClosingElement
          const element = grandparent.parent?.parent
          if (element && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))) {
            const componentBody = findEnclosingComponent(node)
            if (componentBody) {
              ddBindings.push({
                callNode: node,
                innerExprText: innerText,
                position: 'attribute',
                attrName,
                targetElement: element,
                componentBody,
                index: ddIndex++,
              })
            }
          }
        } else {
          // Text position — find the parent JSX element
          const targetElement = findParentJsxElement(parent)
          if (targetElement) {
            const componentBody = findEnclosingComponent(node)
            if (componentBody) {
              ddBindings.push({
                callNode: node,
                innerExprText: innerText,
                position: 'text',
                targetElement,
                componentBody,
                index: ddIndex++,
              })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visitDD)
  }

  visitDD(sourceFile)

  // Group bindings by component body
  const bindingsByComponent = new Map<ts.Block, DollarDollarBinding[]>()
  for (const binding of ddBindings) {
    const existing = bindingsByComponent.get(binding.componentBody)
    if (existing) {
      existing.push(binding)
    } else {
      bindingsByComponent.set(binding.componentBody, [binding])
    }
  }

  // Apply $$ rewrites
  for (const binding of ddBindings) {
    const callStart = binding.callNode.getStart(sourceFile)
    const callEnd = binding.callNode.getEnd()

    // For getter expressions (arrow functions), extract the body
    const arg = binding.callNode.arguments[0]
    let replacementExpr: string
    if (ts.isArrowFunction(arg) && !ts.isBlock(arg.body)) {
      // () => expr  ->  expr
      replacementExpr = code.slice(arg.body.getStart(sourceFile), arg.body.getEnd())
    } else {
      replacementExpr = binding.innerExprText
    }

    // Replace $$(expr) with expr
    rewrites.push({ start: callStart, end: callEnd, replacement: replacementExpr })
  }

  // Track which ref index was assigned to each element (reuse for multiple bindings)
  const elementRefIndex = new Map<ts.Node, number>()

  // Assign ref indices: reuse existing ref when element already has one
  for (const binding of ddBindings) {
    const el = binding.targetElement
    const existingIndex = elementRefIndex.get(el)
    if (existingIndex !== undefined) {
      // Reuse the same ref index for subsequent bindings on the same element
      binding.index = existingIndex
      continue
    }
    elementRefIndex.set(el, binding.index)

    // Insert ref={__$$N} after the last attribute, before the closing > or />
    // Uses el.attributes.end (AST position) instead of string search, which is
    // safe even when attribute values contain '>' characters.
    const insertPos = el.attributes.end
    if (ts.isJsxSelfClosingElement(el)) {
      rewrites.push({ start: insertPos, end: insertPos, replacement: ` ref={__$$${binding.index}}` })
    } else {
      rewrites.push({ start: insertPos, end: insertPos, replacement: ` ref={__$$${binding.index}}` })
    }
  }

  // Insert ref declarations and useDirectBindings at component body start
  for (const [body, bindings] of bindingsByComponent) {
    const bodyStart = body.getStart(sourceFile) + 1 // after {

    const refDecls = bindings.map(b => `\n  const __$$${b.index} = useRef(null)`).join('')

    const bindingEntries = bindings.map(b => {
      const getterExpr = (ts.isArrowFunction(b.callNode.arguments[0]) || ts.isFunctionExpression(b.callNode.arguments[0]))
        ? b.innerExprText
        : `() => ${b.innerExprText}`

      if (b.position === 'attribute' && b.attrName) {
        return `{ ref: __$$${b.index}, getter: ${getterExpr}, attr: '${b.attrName}' }`
      }
      return `{ ref: __$$${b.index}, getter: ${getterExpr} }`
    })

    const hookCall = `\n  useDirectBindings([${bindingEntries.join(', ')}])`

    rewrites.push({ start: bodyStart, end: bodyStart, replacement: refDecls + hookCall })
  }

  // Sort by start descending so overwrites don't shift positions
  rewrites.sort((a, b) => b.start - a.start)

  for (const r of rewrites) {
    if (r.start === r.end) {
      s.appendLeft(r.start, r.replacement)
    } else {
      s.overwrite(r.start, r.end, r.replacement)
    }
  }

  const hasRewrites = rewrites.length > 0
  const hasDDBindings = ddBindings.length > 0

  if (!hasRewrites) return null

  // Add react imports for $$ transformation using AST-based import detection.
  if (hasDDBindings) {
    // Walk top-level statements to find existing import declarations
    let reactImportDecl: ts.ImportDeclaration | null = null
    let sgReactImportDecl: ts.ImportDeclaration | null = null

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const source = stmt.moduleSpecifier.text
        if (source === 'react') {
          reactImportDecl = stmt
        } else if (source === '@supergrain/react') {
          sgReactImportDecl = stmt
        }
      }
    }

    // Add useRef from react
    if (!code.includes('useRef')) {
      if (reactImportDecl?.importClause?.namedBindings && ts.isNamedImports(reactImportDecl.importClause.namedBindings)) {
        const namedImports = reactImportDecl.importClause.namedBindings
        const closeBrace = namedImports.getEnd() - 1
        s.appendLeft(closeBrace, ', useRef')
      } else {
        s.prepend(`import { useRef } from 'react';\n`)
      }
    }

    // Add useDirectBindings from @supergrain/react
    if (!code.includes('useDirectBindings')) {
      if (sgReactImportDecl?.importClause?.namedBindings && ts.isNamedImports(sgReactImportDecl.importClause.namedBindings)) {
        const namedImports = sgReactImportDecl.importClause.namedBindings
        const closeBrace = namedImports.getEnd() - 1
        s.appendLeft(closeBrace, ', useDirectBindings')
      } else {
        s.prepend(`import { useDirectBindings } from '@supergrain/react';\n`)
      }
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
 * Vite plugin that compiles $$() calls into direct DOM bindings.
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
      if (id.includes('/node_modules/') || id.includes('\\node_modules\\')) return null

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
