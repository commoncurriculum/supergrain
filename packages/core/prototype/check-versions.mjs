import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const alienPath = require.resolve('alien-signals').replace(/\/esm\/.*|\/cjs\/.*|\/dist\/.*/, '/package.json')
const preactPath = require.resolve('@preact/signals-core').replace(/\/dist\/.*/, '/package.json')

const alien = JSON.parse(readFileSync(alienPath, 'utf8'))
const preact = JSON.parse(readFileSync(preactPath, 'utf8'))

console.log('alien-signals:', alien.version)
console.log('@preact/signals-core:', preact.version)
