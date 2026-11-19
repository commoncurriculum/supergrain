import { logMutation } from "./array-log";
import {
  $ELEMENTS,
  $HAS_FIELD_NODES,
  $OWN_KEYS,
  $VERSION,
  unwrap,
  getNodesIfExist,
  type DataNodes,
} from "./core";
import { profileSignalWrite } from "./profiler";

// Not `signal(signal() + 1)`: that read would subscribe the active effect to
// the signal it writes, looping on every mutation inside a tracked render.
let BUMP = 0;

export function bumpVersion(target: object): void {
  getNodesIfExist(target)?.[$VERSION]?.(++BUMP);
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

function bumpElementsSignal(nodes: DataNodes | undefined): void {
  const elements = nodes?.[$ELEMENTS];
  if (elements) {
    elements(++BUMP);
  }
}

export function setProperty(target: any, key: PropertyKey, value: any): void {
  if (Array.isArray(target)) {
    if (key === "length") return writeLength(target, value);
    const index = arrayIndex(key);
    if (index !== -1) return writeIndex(target, index, value);
  }
  const hadKey = Object.hasOwn(target, key);
  const oldValue = target[key];
  target[key] = value;
  if (unwrap(oldValue) !== unwrap(value)) {
    bumpVersion(target);
    const node = getNodesIfExist(target)?.[key];
    if (node) {
      profileSignalWrite();
      node(value);
    }
  }
  if (!hadKey) bumpOwnKeysSignal(target);
}

export function deleteProperty(target: any, key: PropertyKey): void {
  if (!Object.hasOwn(target, key)) return;
  if (Array.isArray(target)) {
    const index = arrayIndex(key);
    if (index !== -1) return writeIndex(target, index, HOLE);
  }
  delete target[key];
  bumpVersion(target);
  // A non-extensible target has no node table.
  const nodes = getNodesIfExist(target);
  const node = nodes?.[key];
  if (node) {
    profileSignalWrite();
    node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- the key now reads undefined
  }
  bumpOwnKeysSignal(target, nodes);
}

const HOLE: unique symbol = Symbol("hole");

function writeIndex(target: Array<unknown>, index: number, value: unknown): void {
  const oldLength = target.length;
  // Past the end, the write also leaves holes from the old end on.
  const from = Math.min(index, oldLength);
  const replaced = target.slice(from, index + 1);
  if (value === HOLE) delete target[index];
  else target[index] = value;
  notifyArrayMutation(target, from, replaced, oldLength);
}

function writeLength(target: Array<unknown>, length: unknown): void {
  const oldLength = target.length;
  const from = Math.min(Number(length), oldLength);
  const replaced = target.slice(from, oldLength);
  (target as { length: unknown }).length = length;
  notifyArrayMutation(target, from, replaced, oldLength);
}

// Every array write, including mutators run on the raw target, must end here.
// The notify contract test pins which signals fire.
export function notifyArrayMutation(
  target: Array<unknown>,
  from: number,
  replaced: ReadonlyArray<unknown>,
  oldLength: number,
): void {
  logMutation(target, from, replaced, oldLength);
  const nodes = getNodesIfExist(target);
  const newLength = target.length;
  const shift = newLength - oldLength;
  const lengthChanged = shift !== 0;
  const end = lengthChanged ? Math.max(oldLength, newLength) : from + replaced.length;
  let itemChanged = false;
  let keysChanged = lengthChanged;
  // Skip walking shifted items when nothing reads this array by index.
  const loopEnd = lengthChanged && nodes?.[$HAS_FIELD_NODES] === undefined ? from : end;
  for (let i = from; i < loopEnd; i++) {
    const k = i - from;
    const next = target[i];
    if (!keysChanged && k in replaced !== i in target) keysChanged = true;
    const old = k < replaced.length ? replaced[k] : i < oldLength ? target[i + shift] : undefined;
    if (unwrap(old) !== unwrap(next)) {
      itemChanged = true;
      const node = nodes?.[i];
      if (node) {
        profileSignalWrite();
        node(next);
      }
    }
  }
  if (lengthChanged) {
    const lengthNode = nodes?.["length"];
    if (lengthNode) {
      profileSignalWrite();
      lengthNode(newLength);
    }
  }
  if (keysChanged) {
    bumpVersion(target);
    bumpOwnKeysSignal(target, nodes);
  } else if (itemChanged) {
    bumpElementsSignal(nodes);
  }
}

// Spec max array index (2 ** 32 - 2); larger numbers are ordinary keys.
const MAX_INDEX = 4_294_967_294;

export function arrayIndex(key: PropertyKey): number {
  if (typeof key === "number") return isIndex(key) ? key : -1;
  if (typeof key !== "string") return -1;
  const index = Number(key);
  return isIndex(index) && String(index) === key ? index : -1;
}

function isIndex(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_INDEX;
}

const deletePropertyAndBump = deleteProperty;

export const writeHandler: Pick<ProxyHandler<object>, "set" | "deleteProperty"> = {
  set(target: any, prop: PropertyKey, value: any): boolean {
    setProperty(target, prop, value);
    return true;
  },

  deleteProperty(target: any, prop: PropertyKey): boolean {
    deletePropertyAndBump(target, prop);
    return true;
  },
};
