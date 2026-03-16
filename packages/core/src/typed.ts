import { getNode, getNodes } from './core'
import { defineSignalGetter } from './read'

interface SchemaProp {
  readonly key: string
  readonly value: any
}

export interface SchemaLike {
  readonly props: readonly SchemaProp[]
  readonly infer: any
  (data: unknown): any
}

type ModelProtoEntry = {
  proto: object
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
  const proto = {}

  for (const prop of props) {
    const key = prop.key
    const childProps = safeGetProps(prop.value)

    if (childProps && childProps.length > 0) {
      const childEntry = buildModelProto(childProps)
      Object.defineProperty(proto, key, {
        get() {
          const raw = this._n[key]()
          if (raw === null || raw === undefined) return raw

          const cached = modelViewCache.get(raw)
          if (cached) return cached

          const nodes = getNodes(raw)
          for (const childProp of childProps) {
            if (!nodes[childProp.key])
              getNode(nodes, childProp.key, raw[childProp.key])
          }

          const view = Object.create(childEntry.proto)
          view._n = nodes
          modelViewCache.set(raw, view)
          return view
        },
        enumerable: true,
        configurable: true,
      })
    } else {
      defineSignalGetter(proto, key)
    }
  }

  return { proto }
}

const modelProtoCache = new WeakMap<object, ModelProtoEntry>()
const modelViewCache = new WeakMap<object, object>()

function getModelProto(schema: SchemaLike): ModelProtoEntry {
  let entry = modelProtoCache.get(schema)
  if (!entry) {
    entry = buildModelProto(schema.props)
    modelProtoCache.set(schema, entry)
  }
  return entry
}

export function createModelView<T extends object>(
  raw: any,
  schema: SchemaLike
): T {
  const cached = modelViewCache.get(raw)
  if (cached) return cached as T

  const nodes = getNodes(raw)
  for (const prop of schema.props) {
    if (!nodes[prop.key]) getNode(nodes, prop.key, raw[prop.key])
  }

  const entry = getModelProto(schema)
  const view = Object.create(entry.proto)
  view._n = nodes
  modelViewCache.set(raw, view)
  return view as T
}
