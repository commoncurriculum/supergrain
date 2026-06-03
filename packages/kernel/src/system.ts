// =============================================================================
// Owned reactive system
// =============================================================================
//
// The kernel owns its reactive primitive layer instead of importing
// `signal`/`computed`/`effect` from `alien-signals` directly. The graph
// algorithm (`link`/`unlink`/`propagate`/`checkDirty`/`shallowPropagate`) is
// still delegated to `alien-signals/system` via `createReactiveSystem(...)` —
// we only own the thin operator layer (the ~250 LOC of `update`/`notify`/
// `unwatched` + the `*Oper` functions) so that the `unwatched` callback can
// fire per-node observation handlers when a reactive node loses its last
// subscriber.
//
// The operator layer is a faithful port of alien-signals 3.x's default system
// (see `node_modules/alien-signals/esm/index.mjs`). Behavior is identical; the
// only addition is that `unwatched` records last-subscriber-removed nodes for a
// coalesced, microtask-deferred `onUnobserved` dispatch (see below). The hot
// path — `link` and the `*Oper` functions — is untouched: there is no
// first-subscriber hook, and the `unwatched` bookkeeping is gated behind a
// counter that stays `0` until a handler is registered, so code that never uses
// observation (e.g. the js-framework-benchmark) pays nothing.

import { createReactiveSystem, type Link, type ReactiveNode } from "alien-signals/system";

// ─── ReactiveFlags (ported literals — see alien-signals/system) ──────────────
const Mutable = 1;
const Watching = 2;
const RecursedCheck = 4;
const Recursed = 8;
const Dirty = 16;
const Pending = 32;
const HasChildEffect = 64;

// ─── Node shapes (structural, matching alien-signals' duck-typed nodes) ──────
//
// The link-pointer props are `Link | undefined` (rather than alien's optional
// `Link`) so the operator layer can construct and reset them to `undefined`
// explicitly under `exactOptionalPropertyTypes`. Public signatures use alien's
// `ReactiveNode`; the few boundary conversions are cast.
interface BaseNode {
  deps?: Link | undefined;
  depsTail?: Link | undefined;
  subs?: Link | undefined;
  subsTail?: Link | undefined;
  flags: number;
}

interface SignalNode<T = unknown> extends BaseNode {
  currentValue: T;
  pendingValue: T;
}

interface ComputedNode<T = unknown> extends BaseNode {
  value: T | undefined;
  getter: (previousValue?: T) => T;
}

interface EffectNode extends BaseNode {
  fn: () => void | (() => void);
  cleanup: (() => void) | undefined;
}

// ─── Module state (mirrors alien-signals' module-local cursor) ───────────────
let cycle = 0;
let runDepth = 0;
let batchDepth = 0;
let notifyIndex = 0;
let queuedLength = 0;
// eslint-disable-next-line unicorn/no-useless-undefined -- init-declarations requires an initializer for this module-level cursor
let activeSub: BaseNode | undefined = undefined;
const queued: Array<BaseNode | undefined> = [];

// ─── Observation registry ────────────────────────────────────────────────────
//
// `onUnobserved` rides the graph's natural last-subscriber-removed event
// (`unwatched`), but is NOT fired synchronously. A reactive node routinely loses
// and regains its last subscriber within a single turn — e.g. the `tracked()`
// React adapter re-establishes a component's dependencies on every render, so a
// dependency is transiently unlinked then re-linked. Firing on the synchronous
// unlink would thrash (a cancel scheduled-then-cancelled on every re-render).
//
// Instead, unobserved nodes are collected and flushed on a single microtask;
// at flush time each node is re-checked, so a node re-observed within the turn
// fires nothing. The hot path (`signalOper`/`computedOper`/`trackNode` →
// `link`) is unchanged — there is no first-subscriber (`onObserved`) hook, so
// no per-`link` work. Both the queueing and the flush are gated by
// `observerCount`, which stays `0` until a handler is registered (e.g. the
// js-framework-benchmark, which never touches observation, pays nothing).

interface ObservationHandlers {
  onUnobserved?: () => void;
}

const observers = new WeakMap<BaseNode, ObservationHandlers>();
let observerCount = 0;
const pendingUnobserved = new Set<BaseNode>();
let unobservedFlushScheduled = false;

function scheduleUnobservedFlush(): void {
  if (unobservedFlushScheduled) return;
  unobservedFlushScheduled = true;
  queueMicrotask(flushUnobserved);
}

function flushUnobserved(): void {
  unobservedFlushScheduled = false;
  if (pendingUnobserved.size === 0) return;
  const nodes = [...pendingUnobserved];
  pendingUnobserved.clear();
  for (const node of nodes) {
    // Skip nodes re-observed within the turn (e.g. a re-render re-linked it).
    if (node.subs === undefined) {
      const handlers = observers.get(node);
      if (handlers !== undefined && handlers.onUnobserved !== undefined) {
        handlers.onUnobserved();
      }
    }
  }
}

const system = createReactiveSystem({
  update(node: BaseNode): boolean {
    if ("getter" in node) {
      return updateComputed(node as ComputedNode);
    }
    /* c8 ignore start -- dirty-recheck of a signal/effect dep: an alien-signals graph-internal path the kernel's signal/computed/effect usage doesn't deterministically reach */
    if ("currentValue" in node) {
      return updateSignal(node as SignalNode);
    }
    node.flags = Mutable;
    return true;
    /* c8 ignore stop */
  },
  notify(node: BaseNode): void {
    let effect: BaseNode | undefined = node;
    let insertIndex = queuedLength;
    const firstInsertedIndex = insertIndex;
    while (effect !== undefined) {
      queued[insertIndex++] = effect;
      effect.flags &= ~Watching;
      const next: BaseNode | undefined = effect.subs?.sub;
      effect = next !== undefined && (next.flags & Watching) !== 0 ? next : undefined;
    }
    queuedLength = insertIndex;
    let lo = firstInsertedIndex;
    while (lo < --insertIndex) {
      const left = queued[lo];
      queued[lo++] = queued[insertIndex];
      queued[insertIndex] = left;
    }
  },
  unwatched(node: BaseNode): void {
    if ("getter" in node) {
      if (node.depsTail !== undefined) {
        node.flags = Mutable | Dirty;
        disposeAllDepsInReverse(node);
      }
    } else if ("currentValue" in node) {
      // signal: no default disposal behavior
    } else if ("fn" in node) {
      effectOper.call(node as EffectNode);
    } else {
      effectScopeOper.call(node);
    }
    // Defer the observation callback: coalesce + re-check on a microtask so a
    // transient unlink/re-link (a re-render) doesn't fire spuriously.
    if (observerCount !== 0 && observers.has(node)) {
      pendingUnobserved.add(node);
      scheduleUnobservedFlush();
    }
  },
}) as unknown as {
  link: (dep: BaseNode, sub: BaseNode, version: number) => void;
  unlink: (link: Link, sub?: BaseNode) => Link | undefined;
  propagate: (link: Link, innerWrite: boolean) => void;
  checkDirty: (link: Link, sub: BaseNode) => boolean;
  shallowPropagate: (link: Link) => void;
};

const { link, unlink, propagate, checkDirty, shallowPropagate } = system;

// ─── Public cursor accessors ─────────────────────────────────────────────────

export function getActiveSub(): ReactiveNode | undefined {
  return activeSub as ReactiveNode | undefined;
}

export function setActiveSub(sub?: ReactiveNode): ReactiveNode | undefined {
  const prevSub = activeSub;
  activeSub = sub as BaseNode | undefined;
  return prevSub as ReactiveNode | undefined;
}

export function startBatch(): void {
  ++batchDepth;
}

export function endBatch(): void {
  if (!--batchDepth) {
    flush();
  }
}

// ─── Primitive constructors ──────────────────────────────────────────────────

export interface SignalFn<T> {
  (): T;
  (value: T): void;
}

export function signal<T>(): SignalFn<T | undefined>;
export function signal<T>(initialValue: T): SignalFn<T>;
export function signal<T>(initialValue?: T): SignalFn<T> {
  const node: SignalNode<T | undefined> = {
    currentValue: initialValue,
    pendingValue: initialValue,
    subs: undefined,
    subsTail: undefined,
    flags: Mutable,
  };
  return signalOper.bind(node) as SignalFn<T>;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
  const node: ComputedNode<T> = {
    value: undefined,
    subs: undefined,
    subsTail: undefined,
    deps: undefined,
    depsTail: undefined,
    flags: 0,
    getter,
  };
  return computedOper.bind(node as unknown as ComputedNode) as () => T;
}

export function effect(fn: () => void | (() => void)): () => void {
  const e: EffectNode = {
    fn,
    cleanup: undefined,
    subs: undefined,
    subsTail: undefined,
    deps: undefined,
    depsTail: undefined,
    flags: Watching | RecursedCheck,
  };
  const prevSub = setActiveSubNode(e);
  if (prevSub !== undefined) {
    link(e, prevSub, 0);
    prevSub.flags |= HasChildEffect;
  }
  try {
    ++runDepth;
    // `fn` returns `void | (() => void)`; a `void` return is `undefined` at
    // runtime, so narrowing to the cleanup type matches the actual value.
    e.cleanup = e.fn() as (() => void) | undefined;
  } finally {
    --runDepth;
    activeSub = prevSub;
    e.flags &= ~RecursedCheck;
  }
  return effectOper.bind(e);
}

export function effectScope(fn: () => void): () => void {
  const e: BaseNode = {
    deps: undefined,
    depsTail: undefined,
    subs: undefined,
    subsTail: undefined,
    flags: Mutable,
  };
  const prevSub = setActiveSubNode(e);
  if (prevSub !== undefined) {
    link(e, prevSub, 0);
    prevSub.flags |= HasChildEffect;
  }
  try {
    fn();
  } finally {
    activeSub = prevSub;
  }
  return effectScopeOper.bind(e);
}

// Internal variant of setActiveSub that keeps the BaseNode type (no casts).
function setActiveSubNode(sub: BaseNode | undefined): BaseNode | undefined {
  const prevSub = activeSub;
  activeSub = sub;
  return prevSub;
}

// ─── Operators ───────────────────────────────────────────────────────────────

function updateComputed(c: ComputedNode): boolean {
  if (c.flags & HasChildEffect) {
    let link = c.depsTail;
    while (link !== undefined) {
      const prev = link.prevDep;
      const dep = link.dep as BaseNode;
      if (!("getter" in dep) && !("currentValue" in dep)) {
        unlink(link, c);
      }
      link = prev;
    }
  }
  c.depsTail = undefined;
  c.flags = Mutable | RecursedCheck;
  const prevSub = setActiveSubNode(c);
  try {
    ++cycle;
    const oldValue = c.value;
    return oldValue !== (c.value = c.getter(oldValue));
  } finally {
    activeSub = prevSub;
    c.flags &= ~RecursedCheck;
    purgeDeps(c);
  }
}

function updateSignal(s: SignalNode): boolean {
  s.flags = Mutable;
  return s.currentValue !== (s.currentValue = s.pendingValue);
}

function run(e: EffectNode): void {
  const { flags } = e;
  if (flags & Dirty || (flags & Pending && checkDirty(e.deps!, e))) {
    if (flags & HasChildEffect) {
      let link = e.depsTail;
      while (link !== undefined) {
        const prev = link.prevDep;
        const dep = link.dep as BaseNode;
        if (!("getter" in dep) && !("currentValue" in dep)) {
          unlink(link, e);
        }
        link = prev;
      }
    }
    if (e.cleanup) {
      runCleanup(e);
      if (!e.flags) {
        return;
      }
    }
    e.depsTail = undefined;
    e.flags = Watching | RecursedCheck;
    const prevSub = setActiveSubNode(e);
    try {
      ++cycle;
      ++runDepth;
      e.cleanup = e.fn() as (() => void) | undefined;
    } finally {
      --runDepth;
      activeSub = prevSub;
      e.flags &= ~RecursedCheck;
      purgeDeps(e);
    }
  } else if (e.deps !== undefined) {
    e.flags = Watching | (flags & HasChildEffect);
  }
}

function flush(): void {
  try {
    while (notifyIndex < queuedLength) {
      const effect = queued[notifyIndex];
      queued[notifyIndex++] = undefined;
      run(effect as EffectNode);
    }
  } finally {
    // Recovery: an effect threw mid-flush — re-flag the still-queued effects so
    // a later flush re-runs them instead of dropping them.
    while (notifyIndex < queuedLength) {
      const effect = queued[notifyIndex];
      queued[notifyIndex++] = undefined;
      effect!.flags |= Watching | Recursed;
    }
    notifyIndex = 0;
    queuedLength = 0;
  }
}

function computedOper(this: ComputedNode): unknown {
  const { flags } = this;
  if (
    flags & Dirty ||
    (flags & Pending && (checkDirty(this.deps!, this) || ((this.flags = flags & ~Pending), false)))
  ) {
    if (updateComputed(this)) {
      const { subs } = this;
      if (subs !== undefined) {
        shallowPropagate(subs);
      }
    }
  } else if (flags === 0) {
    this.flags = Mutable | RecursedCheck;
    const prevSub = setActiveSubNode(this);
    try {
      this.value = this.getter();
    } finally {
      activeSub = prevSub;
      this.flags &= ~RecursedCheck;
    }
  }
  const sub = activeSub;
  if (sub !== undefined) {
    link(this, sub, cycle);
  }
  return this.value;
}

function signalOper<T>(this: SignalNode<T>, ...value: [] | [T]): T | void {
  if (value.length > 0) {
    // `value.length > 0` guarantees the `[T]` arm, so the element is `T`.
    // oxlint-disable-next-line prefer-destructuring -- destructuring widens the `[] | [T]` element to `T | undefined`
    const next = value[0] as T;
    if (this.pendingValue !== (this.pendingValue = next)) {
      this.flags = Mutable | Dirty;
      const { subs } = this;
      if (subs !== undefined) {
        propagate(subs, !!runDepth);
        if (!batchDepth) {
          flush();
        }
      }
    }
    return;
  }
  if (this.flags & Dirty && updateSignal(this)) {
    const { subs } = this;
    if (subs !== undefined) {
      shallowPropagate(subs);
    }
  }
  const sub = activeSub;
  if (sub !== undefined) {
    link(this, sub, cycle);
  }
  return this.currentValue;
}

function runCleanup(e: EffectNode): void {
  const { cleanup } = e;
  e.cleanup = undefined;
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    cleanup!();
  } finally {
    activeSub = prevSub;
  }
}

function effectOper(this: EffectNode): void {
  effectScopeOper.call(this);
  if (this.cleanup) {
    runCleanup(this);
  }
}

function effectScopeOper(this: BaseNode): void {
  this.flags = 0;
  disposeAllDepsInReverse(this);
  const sub = this.subs;
  if (sub !== undefined) {
    unlink(sub);
  }
}

function disposeAllDepsInReverse(sub: BaseNode): void {
  let link = sub.depsTail;
  while (link !== undefined) {
    const prev = link.prevDep;
    unlink(link, sub);
    link = prev;
  }
}

function purgeDeps(sub: BaseNode): void {
  const { depsTail } = sub;
  let dep = depsTail === undefined ? sub.deps : depsTail.nextDep;
  while (dep !== undefined) {
    dep = unlink(dep, sub);
  }
}

// =============================================================================
// Observation primitives
// =============================================================================

/**
 * Create a dedicated "liveness" reactive node. It is shaped like a signal so
 * the default `unwatched` dispatch treats it as a no-op (no disposal), but it
 * is never written — only its observed-state matters. Read it (subscribe the
 * active sub) via {@link trackNode}; register lifecycle handlers via
 * {@link onObservationChange}; inspect via {@link isObserved}.
 */
export function createObservationNode(): ReactiveNode {
  const node: SignalNode<number> = {
    currentValue: 0,
    pendingValue: 0,
    subs: undefined,
    subsTail: undefined,
    flags: Mutable,
  };
  return node as unknown as ReactiveNode;
}

/**
 * Subscribe the current active subscriber (if any) to `node`, exactly as a
 * normal signal read would. A no-op when there is no active sub (e.g. called
 * outside a tracked render / effect). The node is never written, so this never
 * causes a re-render — it exists only so observation can detect when the node
 * has lost all observers.
 */
export function trackNode(node: ReactiveNode): void {
  const sub = activeSub;
  if (sub !== undefined) {
    link(node as unknown as BaseNode, sub, cycle);
  }
}

/** Whether `node` currently has at least one subscriber. */
export function isObserved(node: ReactiveNode): boolean {
  return (node as unknown as BaseNode).subs !== undefined;
}

/**
 * Register a handler fired when `node` transitions observed→unobserved (its last
 * subscriber is removed). Returns an unregister function; a later registration
 * on the same node replaces the prior handler.
 *
 * `onUnobserved` is **not** fired on the synchronous unlink. Nodes that lose
 * their last subscriber are coalesced and flushed on a microtask, and each is
 * re-checked — so a node unobserved and re-observed within the same turn (a
 * `tracked()` re-render re-establishing its dependencies) fires nothing. Even
 * so, treat it as a hint, not a fact: a later macrotask (a StrictMode remount,
 * a fast nav-back) can re-observe the node, so defer any irreversible work (a
 * grace timer) and re-check {@link isObserved} when it runs.
 */
export function onObservationChange(node: ReactiveNode, handlers: ObservationHandlers): () => void {
  const key = node as unknown as BaseNode;
  if (!observers.has(key)) {
    observerCount++;
  }
  observers.set(key, handlers);
  return () => {
    const current = observers.get(key);
    if (current === handlers) {
      observers.delete(key);
      pendingUnobserved.delete(key);
      observerCount--;
    }
  };
}

export type { ReactiveNode };
