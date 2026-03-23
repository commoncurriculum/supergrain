import { $NODE, $OWN_KEYS, $VERSION, unwrap, getNodes } from "./core";
import { profileSignalWrite } from "./profiler";

export function bumpVersion(target: object): void {
  let nodes = (target as any)[$NODE];
  if (!nodes) {
    // Lazily create nodes + version signal on first mutation
    nodes = getNodes(target);
  }
  const v = nodes[$VERSION];
  if (v) {
    v(v() + 1);
  }
}

export function bumpOwnKeysSignal(target: object, nodes?: Record<PropertyKey, any>): void {
  const resolvedNodes = nodes ?? (target as any)[$NODE];
  if (!resolvedNodes) {
    return;
  }

  const ownKeysSignal = resolvedNodes[$OWN_KEYS];
  if (ownKeysSignal) {
    profileSignalWrite();
    ownKeysSignal(ownKeysSignal() + 1);
  }
}

function bumpSignals(target: any, key: PropertyKey, prevLen: number): void {
  const nodes = (target as any)[$NODE];
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

  const nodes = (target as any)[$NODE];
  if (nodes) {
    const node = nodes[key];
    if (node && didChange) {
      profileSignalWrite();
      node(value);
    }
  }
  bumpSignals(target, key, prevLen);

  if (!hadKey) {
    bumpOwnKeysSignal(target, (target as any)[$NODE]);
  }
}

export function deleteProperty(target: any, key: PropertyKey): void {
  const hadKey = Object.hasOwn(target, key);
  const prevLen = Array.isArray(target) ? target.length : -1;

  delete target[key];

  if (hadKey) {
    bumpVersion(target);

    const nodes = (target as any)[$NODE];
    if (nodes) {
      const node = nodes[key];
      if (node) {
        profileSignalWrite();
        node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- explicitly setting signal value to undefined
      }
    }
    bumpSignals(target, key, prevLen);
    bumpOwnKeysSignal(target, (target as any)[$NODE]);
  }
}

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
    throw new Error(
      'Direct deletion of store state is not allowed. Use the "$unset" operator in the update function.',
    );
  },
};
