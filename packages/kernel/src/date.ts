/**
 * Reactive wrapper for Date.
 *
 * Separate from `collections.ts` because a Date is not a collection: it has no
 * keys, so none of the per-key signal machinery there applies. All it needs is
 * the single version signal every reactive target already has.
 *
 * Internal only — not exported from the package root. `createReactive()` /
 * `wrap()` dispatch here when the value is a Date.
 */

import { getActiveSub } from "alien-signals";

import { $PROXY, $RAW, $VERSION, getNode, getNodes, getNodesIfExist } from "./core";

// Monotonic bump counter — mirrors the ones in write.ts and collections.ts
// (each only needs to differ from the *previous* value on the same signal).
let BUMP = 0;

/**
 * Reads the version signal — the whole-value dependency for a Date.
 *
 * A Date has no per-key state: every mutator moves the same underlying
 * timestamp, so one signal covers every reader. That's simpler than Map/Set,
 * which need per-key signals plus $OWN_KEYS.
 */
function trackVersion(target: object): void {
  if (getActiveSub()) {
    const nodes = getNodes(target);
    getNode(nodes, $VERSION, 0)();
  }
}

/**
 * Notifies readers that the timestamp moved. No `nodes` means nothing ever
 * read this Date, so there is no signal to bump.
 */
function bumpVersion(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  nodes[$VERSION]!(++BUMP);
}

/**
 * Proxies are cached per raw Date so `store.when === store.when` holds and a
 * Date is never wrapped twice.
 */
const dateProxyCache = new WeakMap<Date, Date>();

/**
 * Reactive wrapper for Date.
 *
 * Like Map and Set, Date methods read internal slots, so they have to be
 * invoked with the *raw* Date as `this` — calling them on the proxy throws.
 * The `get` trap therefore returns bound reimplementations rather than letting
 * the method through.
 *
 * Any method whose name starts with `set` is a mutator; everything else reads.
 * That split is exhaustive over `Date.prototype` (including the legacy
 * `setYear`) and stays correct if the language adds more.
 *
 * `instanceof Date` continues to hold because the Proxy target is the original
 * Date.
 */
export function createReactiveDate(rawTarget: Date): Date {
  const cached = dateProxyCache.get(rawTarget);
  if (cached) return cached;

  const handler: ProxyHandler<Date> = {
    get(target, prop, receiver) {
      if (prop === $RAW) return target;
      if (prop === $PROXY) return receiver;

      // `Object.prototype.toString` reads an internal slot, which a Proxy does
      // not forward, so a wrapped Date would report `[object Object]`. Map and
      // Set avoid this only because their prototypes carry a tag; Date's does
      // not. Supplying one keeps `toString`-based date detection working.
      if (prop === Symbol.toStringTag) return "Date";

      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;

      const method = value as (this: Date, ...args: Array<unknown>) => unknown;

      if (typeof prop === "string" && prop.startsWith("set")) {
        return function reactiveDateMutator(...args: Array<unknown>): unknown {
          const before = rawTarget.getTime();
          const result = method.apply(rawTarget, args);
          // `Object.is` rather than `!==` so an invalid date staying invalid
          // (NaN to NaN) does not notify.
          if (!Object.is(rawTarget.getTime(), before)) {
            bumpVersion(target);
          }
          return result;
        };
      }

      return function reactiveDateReader(...args: Array<unknown>): unknown {
        trackVersion(target);
        return method.apply(rawTarget, args);
      };
    },

    has(target, prop) {
      if (prop === $RAW || prop === $PROXY) return true;
      return Reflect.has(target, prop);
    },
  };

  const proxy = new Proxy(rawTarget, handler);
  dateProxyCache.set(rawTarget, proxy);
  return proxy;
}
