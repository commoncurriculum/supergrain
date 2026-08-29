import {
  $ELEMENTS,
  $OWN_KEYS,
  $VERSION,
  bumpSignal,
  unwrap,
  getNodes,
  getNodesIfExist,
} from "./core";
import { profileSignalWrite } from "./profiler";

export function bumpVersion(target: object): void {
  let nodes = getNodesIfExist(target);
  if (!nodes) {
    // Lazily create nodes + version signal on first mutation
    nodes = getNodes(target);
  }
  const v = nodes[$VERSION];
  /* c8 ignore start -- callers that need notifications create the version signal before bumping */
  if (v) {
    bumpSignal(v);
  }
  /* c8 ignore stop */
}

export function bumpOwnKeysSignal(target: object, nodes?: Record<PropertyKey, any>): void {
  const resolvedNodes = nodes ?? getNodesIfExist(target);
  if (!resolvedNodes) {
    return;
  }

  const ownKeysSignal = resolvedNodes[$OWN_KEYS];
  if (ownKeysSignal) {
    profileSignalWrite();
    bumpSignal(ownKeysSignal);
  }
}

function bumpSignals(target: any, key: PropertyKey, prevLen: number): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) {
    return;
  }
  if (Array.isArray(target) && key !== "length") {
    const lengthNode = nodes["length"];
    if (lengthNode && target.length !== prevLen) {
      profileSignalWrite();
      lengthNode(target.length);
    }
  }
}

export function setProperty(target: any, key: PropertyKey, value: any): void {
  const hadKey = Object.hasOwn(target, key);
  const prevLen = Array.isArray(target) ? target.length : -1;
  const oldValue = target[key];

  target[key] = value;

  const didChange = unwrap(oldValue) !== unwrap(value);
  if (didChange) {
    // Skip version bump for array element replacement (same length).
    // Per-index signals already notify element-specific subscribers.
    // Version bump would unnecessarily notify parent components that
    // only care about structural changes (length, add, remove).
    const isArrayElementReplace = Array.isArray(target) && hadKey && target.length === prevLen;
    if (isArrayElementReplace) {
      // Coarse "some element was replaced in place" notification. Subscribers
      // that want to observe replacement at any index without N per-index
      // subscriptions (parent-mode `For`'s swap effect, via
      // trackArrayElements) link to this one signal; bump only if such a
      // subscriber already created it. No profileSignalWrite — this mirrors
      // bumpVersion: version-style bookkeeping, not a value write.
      const elements = getNodesIfExist(target)?.[$ELEMENTS];
      if (elements) {
        bumpSignal(elements);
      }
    } else {
      bumpVersion(target);
    }
  }

  const nodes = getNodesIfExist(target);
  if (nodes) {
    const node = nodes[key];
    if (node && didChange) {
      profileSignalWrite();
      node(value);
    }
  }
  bumpSignals(target, key, prevLen);

  if (!hadKey) {
    bumpOwnKeysSignal(target, getNodesIfExist(target));
  }
}

export function deleteProperty(target: any, key: PropertyKey): void {
  const hadKey = Object.hasOwn(target, key);
  const prevLen = Array.isArray(target) ? target.length : -1;

  delete target[key];

  if (hadKey) {
    bumpVersion(target);

    // Keep the `if (nodes)` guard. It looks like `bumpVersion` should
    // guarantee nodes are attached, but `getNodes` wraps its
    // `Object.defineProperty($NODE, …)` in `try/catch` — non-extensible
    // targets (e.g. `Object.preventExtensions`) leave `$NODE` detached, and
    // `getNodesIfExist` still returns `undefined` here. Removing this guard
    // and using `!` will TypeError on `nodes[key]`. See store.test.ts
    // "should not throw when deleting a key from a non-extensible target".
    const nodes = getNodesIfExist(target);
    if (nodes) {
      const node = nodes[key];
      if (node) {
        profileSignalWrite();
        node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- explicitly setting signal value to undefined
      }
    }
    bumpSignals(target, key, prevLen);
    bumpOwnKeysSignal(target, nodes);
  }
}

// Local alias so the proxy trap (also named `deleteProperty`) can call the
// standalone helper without colliding with the trap's own name.
const deletePropertyAndBump = deleteProperty;

export const writeHandler: Pick<ProxyHandler<object>, "set" | "deleteProperty"> = {
  set(target: any, prop: PropertyKey, value: any): boolean {
    setProperty(target, prop, value);
    return true;
  },

  deleteProperty(target: any, prop: PropertyKey): boolean {
    if (Array.isArray(target)) {
      // Silent delete for signal values: splice/pop/shift handle element
      // moves via set(). Bump ownKeys so structural subscribers detect
      // the change.
      const hadKey = Object.hasOwn(target, prop);
      // target is narrowed to Array<any> after isArray check; PropertyKey
      // includes symbol which can't index an array — cast through unknown.
      delete (target as unknown as Record<PropertyKey, unknown>)[prop];
      if (hadKey) {
        bumpOwnKeysSignal(target);
      }
      return true;
    }
    deletePropertyAndBump(target, prop);
    return true;
  },
};
