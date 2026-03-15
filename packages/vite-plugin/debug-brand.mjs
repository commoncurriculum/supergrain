import ts from 'typescript'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.resolve('packages/js-krauset-compiled')
const mainFile = path.resolve(rootDir, 'src/main.tsx')
const coreIndex = path.resolve('packages/core/src/index.ts')
const reactIndex = path.resolve('packages/react/src/index.ts')

const options = {
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  paths: {
    '@supergrain/core': [coreIndex],
    '@supergrain/react': [reactIndex],
  },
  baseUrl: rootDir,
}

const program = ts.createProgram([mainFile], options)
const checker = program.getTypeChecker()
const sf = program.getSourceFile(mainFile)

let found = false
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(sf)
    if (name === 'store' || name === '[store]') {
      const type = checker.getTypeAtLocation(node)
      console.log('found:', name, 'type:', checker.typeToString(type))
      for (const prop of type.getProperties()) {
        console.log('  prop:', prop.getName())
      }
      found = true
    }
  }
  ts.forEachChild(node, visit)
}
visit(sf)
if (!found) console.log('store variable not found')

// Check diagnostics
const diags = ts.getPreEmitDiagnostics(program)
console.log('\nDiagnostics:', diags.length)
for (const d of diags.slice(0, 5)) {
  console.log(' ', ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}
