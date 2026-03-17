import { $NODE, $OWN_KEYS, $VERSION, unwrap, getNodes } from './core'

export function bumpVersion(target: object): void {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    // Lazily create nodes + version signal on first mutation
    nodes = getNodes(target)
  }
  const v = nodes[$VERSION]
  if (v) v(v() + 1)
}

export function bumpOwnKeysSignal(
  target: object,
  nodes?: Record<PropertyKey, any>
): void {
  const resolvedNodes = nodes ?? (target as any)[$NODE]
  if (!resolvedNodes) return

  const ownKeysSignal = resolvedNodes[$OWN_KEYS]
  if (ownKeysSignal) {
    ownKeysSignal(ownKeysSignal() + 1)
  }
}

export function setProperty(
  target: any,
  key: PropertyKey,
  value: any,
  isDelete = false
): void {
  const hadKey = Object.prototype.hasOwnProperty.call(target, key)
  const prevLen = Array.isArray(target) ? target.length : -1
  const oldValue = target[key]

  if (isDelete) delete target[key]
  else {
    target[key] = value
  }

  const didChange = isDelete ? hadKey : unwrap(oldValue) !== unwrap(value)
  if (didChange) {
    bumpVersion(target)
  }

  const nodes = (target as any)[$NODE]
  if (nodes) {
    const node = nodes[key]
    if (node && didChange) {
      node(isDelete ? undefined : value)
    }
    if (Array.isArray(target) && key !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== prevLen) lengthNode(target.length)
    }
  }

  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if (wasAdded || wasDeleted) {
    bumpOwnKeysSignal(target, nodes)
  }
}

export const writeHandler: Pick<
  ProxyHandler<object>,
  'set' | 'deleteProperty'
> = {
  set(target: any, prop: PropertyKey, value: any): boolean {
    setProperty(target, prop, value)
    return true
  },

  deleteProperty(target: any, prop: PropertyKey): boolean {
    if (Array.isArray(target)) {
      // Silent delete for signal values: splice/pop/shift handle element
      // moves via set(). But bump ownKeys so structural subscribers
      // (like useView's $TRACK) detect the change.
      const hadKey = Object.prototype.hasOwnProperty.call(target, prop)
      delete target[prop as any]
      if (hadKey) {
        bumpOwnKeysSignal(target)
      }
      return true
    }
    throw new Error(
      'Direct deletion of store state is not allowed. Use the "$unset" operator in the update function.'
    )
  },
}
