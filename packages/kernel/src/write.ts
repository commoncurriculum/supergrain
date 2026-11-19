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

// Monotonic counter feeding every counter-style signal write. The value only
// needs to differ from the previous one so `Object.is` detects a change and
// subscribers re-run; its specific number is not observed by anyone. Using a
// module-local `++` avoids `signal(signal() + 1)` — the signal read there
// would subscribe the active `currentSub` to the very signal we're about to
// write, turning every proxy mutation inside a tracked render into a
// self-triggering loop.
let BUMP = 0;

// The version signal is made by its first reader, so a write before that
// has no one to tell.
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

// Coarse "some element was replaced in place" notification. Subscribers that
// want to observe replacement at any index without N per-index subscriptions
// (parent-mode `For`'s swap effect, via trackArrayElements) link to this one
// signal; bump only if such a subscriber already created it. No
// profileSignalWrite — this mirrors bumpVersion: version-style bookkeeping,
// not a value write.
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
  // No `!`: a non-extensible target has no node table. See store.test.ts
  // "should not throw when deleting a key from a non-extensible target".
  const nodes = getNodesIfExist(target);
  const node = nodes?.[key];
  if (node) {
    profileSignalWrite();
    node(undefined); // eslint-disable-line unicorn/no-useless-undefined -- the key now reads undefined
  }
  bumpOwnKeysSignal(target, nodes);
}

/** What `writeIndex` writes to delete an item, leaving a hole. */
const HOLE: unique symbol = Symbol("hole");

/** Write `value` at `index` of array `target` (or delete it, for `HOLE`), then log and notify. */
function writeIndex(target: Array<unknown>, index: number, value: unknown): void {
  const oldLength = target.length;
  // Past the end, the write also leaves holes from the old end on.
  const from = Math.min(index, oldLength);
  const replaced = target.slice(from, index + 1);
  if (value === HOLE) delete target[index];
  else target[index] = value;
  notifyArrayMutation(target, from, replaced, oldLength);
}

/** Set array `target`'s `length`, then log and notify. */
function writeLength(target: Array<unknown>, length: unknown): void {
  const oldLength = target.length;
  const from = Math.min(Number(length), oldLength);
  const replaced = target.slice(from, oldLength);
  (target as { length: unknown }).length = length;
  notifyArrayMutation(target, from, replaced, oldLength);
}

/**
 * Every array write ends here: an index or `length` write, a delete, or a
 * mutator (`push`, `splice`, `sort`, …) that ran on the raw target. Every
 * such write is a splice: at `from`, the old items `replaced` (holes kept)
 * gave way to new ones, and the items after them moved by the change in
 * length. Given those and the old length, it logs the change and fires each
 * signal whose value changed:
 *
 * - an index's signal, if the item there changed;
 * - `length`, if the length changed;
 * - own keys and the version, if the length changed or an index gained or
 *   lost an item;
 * - otherwise `$ELEMENTS`, if an item changed.
 *
 * The notify contract test checks this against every kind of reader.
 */
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
  // A new length counts as new keys (an extra rerun is allowed, and it
  // saves two `in` checks per index on long splices). At the same length,
  // only a hole made or filled changes the keys, and every index looked at
  // is one of `replaced`.
  let keysChanged = lengthChanged;
  // With a new length, the loop below only looks for index signals to fire
  // (the keys changed anyway): skip it when there are none, so a splice in a
  // long array that nothing reads by index costs no walk of what it shifted.
  const loopEnd = lengthChanged && nodes?.[$HAS_FIELD_NODES] === undefined ? from : end;
  for (let i = from; i < loopEnd; i++) {
    const k = i - from;
    const next = target[i];
    if (!keysChanged && k in replaced !== i in target) keysChanged = true;
    // The old item at `i`: a replaced one, or one that has since moved.
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

/** The largest array index: `2 ** 32 - 2`. A larger number is an ordinary property. */
const MAX_INDEX = 4_294_967_294;

/** The array index a property key names, or -1 if it names none. */
export function arrayIndex(key: PropertyKey): number {
  if (typeof key === "number") return isIndex(key) ? key : -1;
  if (typeof key !== "string") return -1;
  const index = Number(key);
  return isIndex(index) && String(index) === key ? index : -1;
}

function isIndex(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_INDEX;
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
    deletePropertyAndBump(target, prop);
    return true;
  },
};
