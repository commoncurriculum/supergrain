/**
 * Model prototype — thin layer on ArkType that produces optimized reactive stores.
 *
 * Key ideas being validated:
 * 1. Walk ArkType .props to build a signal blueprint
 * 2. Pre-allocate signals from blueprint at store creation (no lazy creation)
 * 3. Specialized proxy handler that uses signal map for known paths
 * 4. Array items get their own signal maps stamped from item blueprint
 * 5. Direct assignment (store.key = val) routes to signal map
 */

import { type, type Type } from 'arktype'
import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'

type Signal<T> = {
  (): T
  (value: T): void
}

// --- Blueprint ---

interface LeafBlueprint {
  kind: 'leaf'
}

interface ObjectBlueprint {
  kind: 'object'
  children: Record<string, Blueprint>
}

interface ArrayBlueprint {
  kind: 'array'
  itemKind: 'leaf' | 'object'
  itemBlueprint?: Record<string, Blueprint> // only for arrays of objects
}

type Blueprint = LeafBlueprint | ObjectBlueprint | ArrayBlueprint

/** Check if an ArkType type has props (is an object type). */
function hasProps(t: any): boolean {
  try {
    return t.props && t.props.length > 0
  } catch {
    return false
  }
}

/**
 * Walk an ArkType type's .props to produce a blueprint.
 */
function buildBlueprint(t: Type): Record<string, Blueprint> {
  const result: Record<string, Blueprint> = {}

  for (const prop of (t as any).props) {
    const key = prop.key as string
    const valueType = prop.value
    const expr: string = valueType.expression

    if (expr.endsWith('[]')) {
      // Array type — check if it's an array of objects
      // Use .select('structure') to find the inner object type
      let innerObj: any = null
      try {
        const structures = valueType.select('structure')
        innerObj = structures.find(
          (s: any) => {
            try { return s.props && s.props.length > 0 && !s.expression.endsWith('[]') }
            catch { return false }
          }
        )
      } catch {
        // Not a structured type
      }

      if (innerObj) {
        result[key] = {
          kind: 'array',
          itemKind: 'object',
          itemBlueprint: buildBlueprint(innerObj),
        }
      } else {
        result[key] = { kind: 'array', itemKind: 'leaf' }
      }
    } else if (hasProps(valueType)) {
      // Nested object
      result[key] = {
        kind: 'object',
        children: buildBlueprint(valueType),
      }
    } else {
      // Leaf value (string, number, boolean, etc.)
      result[key] = { kind: 'leaf' }
    }
  }

  return result
}

// --- Signal Map ---

const $SIGNALS = Symbol.for('supergrain:signals')
const $BLUEPRINT = Symbol.for('supergrain:blueprint')
const $RAW = Symbol.for('supergrain:raw')

interface SignalMap {
  [key: string]: Signal<any>
}

/**
 * Create a signal map for an object based on its blueprint.
 * Pre-allocates a signal for every known leaf path.
 */
function createSignalMap(
  data: any,
  blueprint: Record<string, Blueprint>
): SignalMap {
  const signals: SignalMap = {}

  for (const key in blueprint) {
    const bp = blueprint[key]
    const value = data[key]

    if (bp.kind === 'leaf') {
      signals[key] = signal(value) as Signal<any>
    } else if (bp.kind === 'object') {
      // Nested object: create signals for its children
      // Store a signal for the object ref itself (for replacement)
      signals[key] = signal(value) as Signal<any>
      if (value != null) {
        const childSignals = createSignalMap(value, bp.children)
        // Flatten with dot paths
        for (const childKey in childSignals) {
          signals[`${key}.${childKey}`] = childSignals[childKey]
        }
        // Attach signal map to the nested object for proxy access
        attachSignalMap(value, childSignals, bp.children)
      }
    } else if (bp.kind === 'array') {
      // Array: signal for the array itself (length/iteration tracking)
      signals[key] = signal(value) as Signal<any>
      // Stamp each existing item
      if (Array.isArray(value) && bp.itemKind === 'object' && bp.itemBlueprint) {
        for (const item of value) {
          stampArrayItem(item, bp.itemBlueprint)
        }
      }
    }
  }

  return signals
}

/**
 * Stamp an array item with its own signal map from the item blueprint.
 */
function stampArrayItem(
  item: any,
  itemBlueprint: Record<string, Blueprint>
): void {
  if (item == null || typeof item !== 'object') return
  const itemSignals = createSignalMap(item, itemBlueprint)
  attachSignalMap(item, itemSignals, itemBlueprint)
}

function attachSignalMap(
  target: any,
  signals: SignalMap,
  blueprint: Record<string, Blueprint>
): void {
  Object.defineProperty(target, $SIGNALS, {
    value: signals,
    enumerable: false,
    configurable: true,
  })
  Object.defineProperty(target, $BLUEPRINT, {
    value: blueprint,
    enumerable: false,
    configurable: true,
  })
}

// --- Optimized Proxy Handler ---

function createModelHandler(
  blueprint: Record<string, Blueprint>
): ProxyHandler<any> {
  // Pre-compute the set of known keys for fast lookup
  const knownKeys = new Set(Object.keys(blueprint))

  return {
    get(target, prop, receiver) {
      if (prop === $RAW) return target
      if (prop === $SIGNALS) return target[$SIGNALS]
      if (prop === $BLUEPRINT) return target[$BLUEPRINT]

      // Functions: return as-is
      const value = target[prop]
      if (typeof value === 'function') return value

      const signals: SignalMap | undefined = target[$SIGNALS]

      // Unknown key — fall through to raw value
      if (!signals || !knownKeys.has(prop as string)) {
        return value
      }

      const bp = blueprint[prop as string]
      const sig = signals[prop as string]

      if (!sig) return value

      if (!getCurrentSub()) {
        // Not in reactive context — return value, wrap if needed
        if (bp.kind === 'object' || bp.kind === 'array') {
          return wrapWithModel(value, bp)
        }
        return value
      }

      // In reactive context — read signal to track dependency
      const tracked = sig()

      if (bp.kind === 'object' || bp.kind === 'array') {
        return wrapWithModel(tracked, bp)
      }
      return tracked
    },

    set(target, prop, value) {
      const signals: SignalMap | undefined = target[$SIGNALS]

      if (signals && knownKeys.has(prop as string)) {
        const bp = blueprint[prop as string]
        const sig = signals[prop as string]
        const oldValue = target[prop]
        target[prop] = value

        if (sig && oldValue !== value) {
          if (bp.kind === 'array' && bp.itemKind === 'object' && bp.itemBlueprint) {
            // Re-stamp array items
            if (Array.isArray(value)) {
              for (const item of value) {
                if (!item[$SIGNALS]) stampArrayItem(item, bp.itemBlueprint)
              }
            }
          } else if (bp.kind === 'object' && (bp as ObjectBlueprint).children) {
            // Re-create child signals for new nested object
            if (value != null && typeof value === 'object') {
              const childSignals = createSignalMap(value, (bp as ObjectBlueprint).children)
              attachSignalMap(value, childSignals, (bp as ObjectBlueprint).children)
              // Update flattened dot-path signals
              for (const childKey in childSignals) {
                signals[`${prop as string}.${childKey}`] = childSignals[childKey]
              }
            }
          }
          sig(value)
        }
        return true
      }

      target[prop] = value
      return true
    },

    deleteProperty() {
      throw new Error('Direct deletion not allowed. Use $unset.')
    },
  }
}

/**
 * Wrap a value with the appropriate model-aware proxy.
 */
function wrapWithModel(value: any, bp: Blueprint): any {
  if (value == null || typeof value !== 'object') return value

  if (bp.kind === 'object') {
    // If it already has a signal map, wrap with a handler for its children
    if (value[$SIGNALS]) {
      return new Proxy(value, createModelHandler((bp as ObjectBlueprint).children))
    }
    return value
  }

  if (bp.kind === 'array') {
    // Array items that are objects get their own proxies
    if ((bp as ArrayBlueprint).itemKind === 'object' && (bp as ArrayBlueprint).itemBlueprint) {
      return new Proxy(value, createArrayHandler(bp as ArrayBlueprint))
    }
    return value
  }

  return value
}

/**
 * Proxy handler for arrays of model objects.
 */
function createArrayHandler(bp: ArrayBlueprint): ProxyHandler<any[]> {
  return {
    get(target, prop) {
      const value = target[prop as any]

      if (typeof value === 'function') {
        // Intercept mutating methods
        if (prop === 'push' && bp.itemBlueprint) {
          return (...items: any[]) => {
            for (const item of items) {
              if (!item[$SIGNALS]) stampArrayItem(item, bp.itemBlueprint!)
            }
            return target.push(...items)
          }
        }
        return value.bind(target)
      }

      // Numeric index access — wrap item with its own handler
      if (typeof prop === 'string' && !isNaN(Number(prop))) {
        const item = target[Number(prop)]
        if (item != null && typeof item === 'object' && item[$SIGNALS] && bp.itemBlueprint) {
          return new Proxy(item, createModelHandler(bp.itemBlueprint))
        }
        return item
      }

      return value
    },
  }
}

// --- Public API ---

export interface ModelType<T> {
  (data: unknown): T // ArkType validation
  create(initial: T): [T, (ops: any) => void]
  blueprint: Record<string, Blueprint>
}

export function model<const Def>(def: Def): ModelType<Type<Def>['infer']> {
  const t = type(def as any)
  const blueprint = buildBlueprint(t as any)

  const handler = createModelHandler(blueprint)

  function create(initial: any): [any, (ops: any) => void] {
    // Validate with arktype
    const validated = (t as any)(initial)
    if (validated instanceof type.errors) {
      throw new Error(`Validation failed: ${validated.summary}`)
    }

    // Build signal map
    const signals = createSignalMap(validated, blueprint)
    attachSignalMap(validated, signals, blueprint)

    // Create proxy
    const proxy = new Proxy(validated, handler)

    // Update function (supports $set for batch, or direct mutation via proxy)
    function update(ops: any): void {
      startBatch()
      try {
        if (ops.$set) {
          for (const path in ops.$set) {
            const value = ops.$set[path]
            // Simple path resolution
            const parts = path.split('.')
            let current = validated
            let currentSignals = signals

            for (let i = 0; i < parts.length - 1; i++) {
              current = current[parts[i]]
              currentSignals = current?.[$SIGNALS] || currentSignals
            }

            const finalKey = parts[parts.length - 1]
            const oldValue = current[finalKey]
            current[finalKey] = value

            const sig = currentSignals?.[finalKey]
            if (sig && oldValue !== value) {
              sig(value)
            }
          }
        }
        if (ops.$push) {
          for (const path in ops.$push) {
            const arr = getByPath(validated, path)
            if (Array.isArray(arr)) {
              const items = Array.isArray(ops.$push[path])
                ? ops.$push[path]
                : [ops.$push[path]]
              const pathBp = getBlueprintByPath(blueprint, path)
              if (pathBp?.kind === 'array' && pathBp.itemBlueprint) {
                for (const item of items) {
                  stampArrayItem(item, pathBp.itemBlueprint)
                }
              }
              arr.push(...items)
              // Update the array signal
              const sig = signals[path]
              if (sig) sig(arr)
            }
          }
        }
      } finally {
        endBatch()
      }
    }

    return [proxy, update]
  }

  const result = t as any
  result.create = create
  result.blueprint = blueprint
  return result
}

// --- Helpers ---

function getByPath(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    current = current?.[part]
  }
  return current
}

function getBlueprintByPath(
  bp: Record<string, Blueprint>,
  path: string
): Blueprint | undefined {
  const parts = path.split('.')
  let current: Blueprint | undefined = bp[parts[0]]
  for (let i = 1; i < parts.length; i++) {
    if (!current) return undefined
    if (current.kind === 'object') {
      current = current.children[parts[i]]
    } else {
      return undefined
    }
  }
  return current
}

// --- Re-export for benchmarks ---
export { signal, getCurrentSub } from 'alien-signals'
export { effect } from 'alien-signals'
