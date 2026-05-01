import { $OWN_KEYS, $VERSION, nextBump, unwrap, getNodes, getNodesIfExist } from "./core";
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
    v(nextBump());
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
    ownKeysSignal(nextBump());
  }
}

export function setProperty(target: any, key: PropertyKey, value: any): void {
  const arr: Array<unknown> | null = Array.isArray(target) ? target : null;
  const prevLen = arr ? arr.length : -1;
  const hadKey = Object.hasOwn(target, key);
  const oldValue = target[key];

  target[key] = value;

  const didChange = unwrap(oldValue) !== unwrap(value);
  let nodes = getNodesIfExist(target);

  if (didChange) {
    // Skip version bump for array element replacement (same length).
    // Per-index signals already notify element-specific subscribers.
    // Version bump would unnecessarily notify parent components that
    // only care about structural changes (length, add, remove).
    const isArrayElementReplace = arr !== null && hadKey && arr.length === prevLen;
    if (!isArrayElementReplace) {
      // Lazily ensure nodes (and the $VERSION signal getNodes creates).
      // For non-extensible targets, getNodes returns a transient nodes bag —
      // signal lookups below all miss, so the writes are observable no-ops,
      // matching the previous bumpVersion + guarded re-read pattern.
      if (!nodes) nodes = getNodes(target);
      const versionSignal = nodes[$VERSION];
      /* c8 ignore start -- callers that need notifications create the version signal before bumping */
      if (versionSignal) versionSignal(nextBump());
      /* c8 ignore stop */
    }
  }

  if (nodes) {
    const node = nodes[key];
    if (node && didChange) {
      profileSignalWrite();
      node(value);
    }
    if (arr !== null && key !== "length") {
      const lengthNode = nodes["length"];
      if (lengthNode && arr.length !== prevLen) {
        profileSignalWrite();
        lengthNode(arr.length);
      }
    }
    if (!hadKey) {
      const ownKeysSignal = nodes[$OWN_KEYS];
      if (ownKeysSignal) {
        profileSignalWrite();
        ownKeysSignal(nextBump());
      }
    }
  }
}

export function deleteProperty(target: any, key: PropertyKey): void {
  if (!Object.hasOwn(target, key)) return;

  const arr: Array<unknown> | null = Array.isArray(target) ? target : null;
  const prevLen = arr ? arr.length : -1;

  delete target[key];

  // Lazily ensure nodes for the version bump. For non-extensible targets,
  // getNodes returns a transient nodes bag whose per-key/length/ownKeys slots
  // are all empty, so the signal lookups below no-op — matching the original
  // bumpVersion + guarded re-read pattern that the
  // "should not throw when deleting a key from a non-extensible target" test
  // covers.
  let nodes = getNodesIfExist(target);
  if (!nodes) nodes = getNodes(target);

  const versionSignal = nodes[$VERSION];
  /* c8 ignore start -- callers that need notifications create the version signal before bumping */
  if (versionSignal) versionSignal(nextBump());
  /* c8 ignore stop */

  const node = nodes[key];
  if (node) {
    profileSignalWrite();
    node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- explicitly setting signal value to undefined
  }
  if (arr !== null && key !== "length") {
    const lengthNode = nodes["length"];
    if (lengthNode && arr.length !== prevLen) {
      profileSignalWrite();
      lengthNode(arr.length);
    }
  }
  const ownKeysSignal = nodes[$OWN_KEYS];
  if (ownKeysSignal) {
    profileSignalWrite();
    ownKeysSignal(nextBump());
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
