import { logMutation } from "./array-log";
import { $ELEMENTS, $OWN_KEYS, $VERSION, unwrap, getNodesIfExist, type DataNodes } from "./core";
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
    const index = key === "length" ? -1 : arrayIndex(key);
    if (key === "length" || index !== -1) {
      // A write can change the indices from the lower of the old length and
      // the written index (or new length) on: past the end it leaves holes.
      const oldLength = target.length;
      const at = key === "length" ? Number(value) : index;
      writeArray(target, Math.min(at, oldLength), key === "length" ? oldLength : at + 1, () => {
        (target as unknown as Record<PropertyKey, unknown>)[key] = value;
      });
      return;
    }
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
    if (index !== -1) {
      writeArray(target, index, index + 1, () => {
        delete target[index];
      });
      return;
    }
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

/**
 * Run `write` on array `target`, then log and notify what it changed. The
 * write can only change indices from `from`, up to `end` or the larger of the
 * old and new lengths.
 */
function writeArray(target: Array<unknown>, from: number, end: number, write: () => void): void {
  const oldLength = target.length;
  const replaced = target.slice(from, Math.max(end, from));
  write();
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
  for (let i = from; i < end; i++) {
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

/** The array index a property key names, or -1 if it names none. */
export function arrayIndex(key: PropertyKey): number {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0 ? key : -1;
  if (typeof key !== "string") return -1;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key ? index : -1;
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
