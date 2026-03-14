/**
 * Vite plugin prototype — rewrites model store access to direct signal calls.
 *
 * This is a minimal proof of concept. It handles:
 * - Simple property reads: store.title → store[$SIGNALS].title()
 * - Nested reads: store.assignee.name → store[$SIGNALS]['assignee.name']()
 * - Direct assignment: store.title = 'x' → store[$SIGNALS].title('x')
 *
 * It does NOT handle (falls back to proxy):
 * - Dynamic keys: store[someVar]
 * - Destructuring: const { title } = store
 * - Spread: { ...store }
 * - Passing store refs to other functions
 *
 * Detection: looks for `model()` calls and tracks the variable names
 * from `.create()` calls.
 */

import type { Plugin } from 'vite'

/**
 * Minimal regex-based transform for the prototype.
 * A real implementation would use an AST parser (babel, oxc, swc).
 */
export function supergrainModelPlugin(): Plugin {
  return {
    name: 'supergrain-model',
    enforce: 'pre',

    transform(code: string, id: string) {
      // Only process .ts/.tsx/.js/.jsx files
      if (!/\.[jt]sx?$/.test(id)) return null
      // Skip node_modules
      if (id.includes('node_modules')) return null
      // Only process files that use .create()
      if (!code.includes('.create(')) return null

      // Phase 1: Find model store variables
      // Match: const [storeName, setterName] = SomeModel.create(...)
      const createPattern =
        /const\s+\[(\w+)(?:\s*,\s*(\w+))?\]\s*=\s*(\w+)\.create\(/g
      const storeVars = new Map<string, string>() // storeName → modelName

      let match
      while ((match = createPattern.exec(code)) !== null) {
        storeVars.set(match[1], match[3])
        // Also track the setter if present
        if (match[2]) {
          // We don't rewrite setter calls in this prototype
        }
      }

      if (storeVars.size === 0) return null

      let transformed = code

      for (const [storeName] of storeVars) {
        // Phase 2: Rewrite property reads
        // store.assignee.name → reads through signal map
        //
        // Strategy: find chains like `storeName.foo.bar.baz` and rewrite
        // to direct signal access. We handle up to 3 levels deep.

        // 3-level: store.a.b.c → __sg_read(store, 'a.b.c')
        const threeLevel = new RegExp(
          `(?<!\\.)\\b${storeName}\\.(\\w+)\\.(\\w+)\\.(\\w+)(?!\\s*=)(?!\\s*\\()`,
          'g'
        )
        transformed = transformed.replace(
          threeLevel,
          `__sg_read(${storeName}, '$1.$2.$3')`
        )

        // 2-level: store.a.b → __sg_read(store, 'a.b')
        // But NOT store.a.b = (that's an assignment)
        // And NOT store.a.b( (that's a method call)
        const twoLevel = new RegExp(
          `(?<!\\.)\\b${storeName}\\.(\\w+)\\.(\\w+)(?!\\s*=)(?!\\s*\\()(?!\\.\\w)`,
          'g'
        )
        transformed = transformed.replace(
          twoLevel,
          `__sg_read(${storeName}, '$1.$2')`
        )

        // 1-level: store.a → __sg_read(store, 'a')
        const oneLevel = new RegExp(
          `(?<!\\.)\\b${storeName}\\.(\\w+)(?!\\s*=)(?!\\s*\\()(?!\\.\\w)`,
          'g'
        )
        transformed = transformed.replace(
          oneLevel,
          `__sg_read(${storeName}, '$1')`
        )

        // Phase 3: Rewrite assignments
        // store.title = 'x' → __sg_write(store, 'title', 'x')
        // This is trickier with regex — handle simple single-line cases
        const assignPattern = new RegExp(
          `${storeName}\\.(\\w+(?:\\.\\w+)*)\\s*=\\s*([^;\\n]+)`,
          'g'
        )
        transformed = transformed.replace(
          assignPattern,
          `__sg_write(${storeName}, '$1', $2)`
        )
      }

      // Add runtime helpers if we transformed anything
      if (transformed !== code) {
        const helpers = `
import { getCurrentSub as __sg_getCurrentSub } from 'alien-signals';
const __sg_signals = Symbol.for('supergrain:signals');
function __sg_read(store, path) {
  const signals = store[__sg_signals] || store;
  // For nested paths, try the flattened signal first
  const sig = signals[path];
  if (sig) {
    return __sg_getCurrentSub() ? sig() : sig.peek?.() ?? sig();
  }
  // Fallback: walk the path on the raw object
  return path.split('.').reduce((o, k) => o?.[k], store);
}
function __sg_write(store, path, value) {
  const signals = store[__sg_signals];
  const sig = signals?.[path];
  if (sig) {
    // Update underlying data
    const parts = path.split('.');
    const raw = store[Symbol.for('supergrain:raw')] || store;
    let target = raw;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    target[parts[parts.length - 1]] = value;
    sig(value);
    return;
  }
  // Fallback to proxy set
  const parts = path.split('.');
  let target = store;
  for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
  target[parts[parts.length - 1]] = value;
}
`
        transformed = helpers + transformed
      }

      return {
        code: transformed,
        map: null, // Skip source map for prototype
      }
    },
  }
}
