/**
 * Feasibility prototype: Can the TypeScript compiler API detect $BRAND
 * on the resolved type of a PropertyAccessExpression?
 *
 * Run: npx tsx prototype/plugin-feasibility/detect-branded.ts
 */

import ts from 'typescript'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const inputFile = path.resolve(__dirname, 'input.ts')

// Create a TypeScript program (same as what a Vite plugin would do)
const program = ts.createProgram([inputFile], {
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
})

const checker = program.getTypeChecker()
const sourceFile = program.getSourceFile(inputFile)!

function hasBrand(type: ts.Type): boolean {
  // Check if the type has a property named $BRAND (a unique symbol)
  for (const prop of type.getProperties()) {
    if (prop.getName() === '__@supergrain/brand' || prop.getEscapedName().toString().includes('BRAND')) {
      return true
    }
  }
  // Also check: does the type have a property whose name is a unique symbol
  // that matches our $BRAND declaration?
  const symbol = type.getProperty('__@$BRAND' as any)
  if (symbol) return true

  // Try checking all properties for symbol-typed names
  for (const prop of type.getProperties()) {
    const name = prop.getName()
    if (name.startsWith('__@')) {
      // This is how TS encodes unique symbols in property names
      return true
    }
  }
  return false
}

function visit(node: ts.Node) {
  if (ts.isPropertyAccessExpression(node)) {
    const exprType = checker.getTypeAtLocation(node.expression)
    const propName = node.name.getText()
    const branded = hasBrand(exprType)
    const lineNum = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1

    if (branded) {
      console.log(`✅ LINE ${lineNum}: ${node.getText()} — expression type is BRANDED → would compile to readSignal(${node.expression.getText()}, '${propName}')()`)
    } else {
      console.log(`⬜ LINE ${lineNum}: ${node.getText()} — expression type is NOT branded → left alone`)
    }
  }

  ts.forEachChild(node, visit)
}

console.log('--- Scanning PropertyAccessExpressions ---\n')
visit(sourceFile)

// Also dump the type of 'store' to see what the checker resolves
console.log('\n--- Type inspection ---\n')
sourceFile.forEachChild(node => {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (decl.name.getText() === 'store') {
        const type = checker.getTypeAtLocation(decl)
        console.log(`store type: ${checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation)}`)
        console.log(`store properties:`)
        for (const prop of type.getProperties()) {
          console.log(`  ${prop.getName()} (escaped: ${prop.getEscapedName()})`)
        }
      }
    }
  }
})
