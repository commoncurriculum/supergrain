import { $NODE, $OWN_KEYS, $VERSION, unwrap } from './core'

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

  const nodes = (target as any)[$NODE]
  if (nodes) {
    const node = nodes[key]
    if (node && unwrap(oldValue) !== unwrap(value)) {
      node(isDelete ? undefined : value)
      if ($VERSION in target) {
        const currentVersion = (target as any)[$VERSION] || 0
        ;(target as any)[$VERSION] = currentVersion + 1
      }
    }
    if (Array.isArray(target) && key !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== prevLen) lengthNode(target.length)
    }
  }

  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if ((wasAdded || wasDeleted) && nodes) {
    const ownKeysSignal = nodes[$OWN_KEYS]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
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

  deleteProperty() {
    throw new Error(
      'Direct deletion of store state is not allowed. Use the "$unset" operator in the update function.'
    )
  },
}
