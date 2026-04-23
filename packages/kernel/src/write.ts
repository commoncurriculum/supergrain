import { $OWN_KEYS, $VERSION, unwrap, getNodes, getNodesIfExist } from "./core";
import { profileSignalWrite } from "./profiler";

// Monotonic counter feeding every counter-style signal write. The value only
// needs to differ from the previous one so `Object.is` detects a change and
// subscribers re-run; its specific number is not observed by anyone. Using a
// module-local `++` avoids `signal(signal() + 1)` — the signal read there
// would subscribe the active `currentSub` to the very signal we're about to
// write, turning every proxy mutation inside a tracked render into a
// self-triggering loop.
let BUMP = 0;

export function bumpVersion(target: object): void {
  let nodes = getNodesIfExist(target);
  if (!nodes) {
    // Lazily create nodes + version signal on first mutation
    nodes = getNodes(target);
  }
  const v = nodes[$VERSION];
  if (v) {
    v(++BUMP);
  }
}

export function bumpOwnKeysSignal(target: object, nodes?: Record<PropertyKey, any>): void {
  const resolvedNodes = nodes ?? getNodesIfExist(target);
  if (!resolvedNodes) {
    return;
  }

  const ownKeysSignal = resolvedNodes[$OWN_KEYS];
  if (ownKeysSignal) {
    profileSignalWrite();
    ownKeysSignal(++BUMP);
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
    if (!isArrayElementReplace) {
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

    const nodes = getNodesIfExist(target);
    if (nodes) {
      const node = nodes[key];
      if (node) {
        profileSignalWrite();
        node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- explicitly setting signal value to undefined
      }
    }
    bumpSignals(target, key, prevLen);
    bumpOwnKeysSignal(target, getNodesIfExist(target));
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
      delete target[prop as any];
      if (hadKey) {
        bumpOwnKeysSignal(target);
      }
      return true;
    }
    deletePropertyAndBump(target, prop);
    return true;
  },
};
