import { getNode, getNodes } from './core'
import { attachViewNodes } from './read'

interface SchemaProp {
  readonly key: string
  readonly value: any
}

export interface SchemaLike<TInferred extends object = any> {
  readonly props: readonly SchemaProp[]
  readonly infer: TInferred
  (data: unknown): any
}

type ModelProtoEntry = {
  props: readonly SchemaProp[]
  defineProperties(target: object): void
}

function safeGetProps(typeValue: any): readonly SchemaProp[] | null {
  try {
    const props = typeValue?.props
    if (Array.isArray(props) && props.length > 0) return props
  } catch {
    // .props throws for non-object types (e.g., string, number)
  }
  return null
}

function buildModelProto(props: readonly SchemaProp[]): ModelProtoEntry {
  const descriptors: PropertyDescriptorMap = {}

  for (const prop of props) {
    const key = prop.key
    const childProps = safeGetProps(prop.value)

    if (childProps && childProps.length > 0) {
      const childEntry = buildModelProto(childProps)
      descriptors[key] = {
        get: function (this: any) {
          const raw = this._n[key]()
          if (raw === null || raw === undefined) return raw

          return createModelViewFromEntry(raw, childEntry)
        },
        enumerable: true,
        configurable: true,
      }
    } else {
      descriptors[key] = {
        get: function (this: any) {
          return this._n[key]()
        },
        enumerable: true,
        configurable: true,
      }
    }
  }

  return {
    props,
    defineProperties(target: object) {
      Object.defineProperties(target, descriptors)
    },
  }
}

const modelProtoCache = new WeakMap<object, ModelProtoEntry>()
const modelViewCache = new WeakMap<object, object>()
const modelEntryCache = new WeakMap<object, ModelProtoEntry>()

function assertCompatibleTypedSchema(
  raw: object,
  entry: ModelProtoEntry
): void {
  const cachedEntry = modelEntryCache.get(raw)
  if (cachedEntry && cachedEntry !== entry) {
    throw new Error(
      'A raw object cannot be used with multiple typed store schemas.'
    )
  }
}

function getModelProto(schema: SchemaLike): ModelProtoEntry {
  let entry = modelProtoCache.get(schema)
  if (!entry) {
    entry = buildModelProto(schema.props)
    modelProtoCache.set(schema, entry)
  }
  return entry
}

function createModelViewFromEntry<T extends object>(
  raw: any,
  entry: ModelProtoEntry
): T {
  const cached = modelViewCache.get(raw)
  if (cached) {
    assertCompatibleTypedSchema(raw, entry)
    return cached as T
  }

  const view = {}
  const nodes = getNodes(raw)
  for (const prop of entry.props) {
    if (!nodes[prop.key]) getNode(nodes, prop.key, raw[prop.key])
  }
  attachViewNodes(view, nodes)
  entry.defineProperties(view)
  Object.freeze(view)
  modelEntryCache.set(raw, entry)
  modelViewCache.set(raw, view)
  return view as T
}

export function createModelView<T extends object>(
  raw: any,
  schema: SchemaLike
): T {
  const entry = getModelProto(schema)
  assertCompatibleTypedSchema(raw, entry)

  const nodes = getNodes(raw)
  for (const prop of schema.props) {
    if (!nodes[prop.key]) getNode(nodes, prop.key, raw[prop.key])
  }

  return createModelViewFromEntry(raw, entry)
}
