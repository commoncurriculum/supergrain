import type { DocumentTypes } from "./store";

// =============================================================================
// StoreHooks — store-wide lifecycle hooks
// =============================================================================

/**
 * Store-wide lifecycle hooks, declared once at store creation and parallel to
 * `models` / `queries` in `DocumentStoreConfig`. The single place for
 * cross-cutting behavior that must run no matter which code path reaches the
 * store. Grouping hooks under one key (rather than scattering them onto the
 * config root) keeps the surface extensible — future hooks slot in here without
 * widening `DocumentStoreConfig` itself.
 *
 * Both hooks bracket **every** `insertDocument(type, doc)` and form the
 * pipeline `prepareInsert → insertDocument → afterInsert`. They are
 * **generic over the type key `K`**, so `doc` is typed `M[K]` (and a
 * `prepareInsert` return is checked against `M[K]` too — you can't return a
 * doc of the wrong model). Inside an implementation, `doc` widens to the model
 * union; narrow it with a literal discriminant on the doc itself
 * (`if (doc.type === "card-stack")`). Do **not** rely on testing the `type`
 * argument to narrow `doc` — TypeScript does not correlate a generic parameter
 * with `type`, so models without a self-carried discriminant need an explicit
 * cast.
 */
export interface StoreHooks<M extends DocumentTypes> {
  /**
   * Normalization hook run on **every** `insertDocument(type, doc)` — a direct
   * `store.insertDocument(...)`, a response-processor insert (including
   * JSON-API `included` sideloads), a Provider `initial` seed, or any future
   * code path. The one funnel every document passes through on its way into the
   * cache, so shape migrations and defaulting live in exactly one place.
   *
   * **Return semantics** (matching the response-processor `?? response`
   * convention):
   * - **Return the doc** (or a wholesale replacement of the same model) — that
   *   object is what gets stored.
   * - **Return nothing** (`undefined` / no `return`) — pass-through: the
   *   (possibly mutated-in-place) `doc` you were given is stored unchanged.
   *   Forgetting `return doc` after an in-place edit is therefore harmless.
   * - **Return `null`** — veto: nothing is written. The only way to drop a
   *   record. Use it to filter records that must never enter the cache. ⚠️ If a
   *   `find(type, id)` requested this exact doc, vetoing it settles that handle
   *   as a `NotFoundError` (the fetch succeeded but produced no cached doc).
   *
   * Because the queries layer (`@supergrain/queries`) stores its result
   * envelopes and their sideloads through `insertDocument`, this hook also sees
   * those envelopes. Return docs you don't recognize **unchanged** (the default
   * pass-through path does this for you) — only `return null` for shapes you
   * deliberately want dropped.
   *
   * For a brand-new object this runs *before* the doc is wrapped in the
   * reactive proxy, so in-place edits notify no subscribers — they're part of
   * building the document. (Re-inserting an object that is already cached and
   * being observed mutates the live target directly; prefer returning a
   * replacement in that case.)
   *
   * A throw here propagates (on a fetch it surfaces as a `ProcessorError`) —
   * `prepareInsert` is part of building the document, so its failure fails the
   * insert.
   *
   * @example
   * ```ts
   * createDocumentStore<TypeToModel>({
   *   hooks: {
   *     prepareInsert(type, doc) {
   *       if (doc.archived) return null; // drop — never cache archived docs
   *       if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
   *       doc.meta ??= {};
   *       return doc;
   *     },
   *   },
   *   models: { ... },
   * });
   * ```
   */
  prepareInsert?: <K extends keyof M & string>(type: K, doc: M[K]) => M[K] | null | void;

  /**
   * Side-effect observer run **after** a document's value is committed to the
   * cache by `insertDocument(type, doc)` — the tail of
   * `prepareInsert → insertDocument → afterInsert`. Fires for every insertion
   * path once per committed document.
   *
   * Timing: the value is in the cache when this runs (`findInMemory(type,
   * doc.id)` returns it). When the insert happens inside an enclosing batch — a
   * fetch commit, or your own `batch(...)` — subscriber *notifications* are
   * still pending and flush when that outermost batch ends. So: rely on the
   * cache being settled, not on dependent effects/renders having run yet.
   *
   * Receives the `type` and the **doc that was actually stored** (the
   * post-`prepareInsert` object, same reference as
   * `unwrap(store.findInMemory(type, doc.id))`). This is the raw target, not
   * the reactive proxy — treat it as read-only; mutating it bypasses
   * reactivity. The return value is ignored. Use it to mirror the document into
   * another store, update a derived index, or emit telemetry.
   *
   * A throw here is **isolated**: it is reported to the store's `onError` sink
   * and otherwise swallowed, so a failing observer never corrupts the commit or
   * fails sibling documents in the same fetch. Does **not** run when
   * `prepareInsert` vetoes (nothing was written). Calling
   * `store.insertDocument(...)` from inside re-enters the hooks — fine for
   * cascading related records, but guard against unbounded recursion.
   *
   * @example
   * ```ts
   * createDocumentStore<TypeToModel>({
   *   hooks: {
   *     // Bridge every committed Supergrain insert back into the Ember store.
   *     afterInsert: (type, doc) => emberStore.insertDocument(doc),
   *   },
   *   models: { ... },
   * });
   * ```
   */
  afterInsert?: <K extends keyof M & string>(type: K, doc: M[K]) => void;
}
