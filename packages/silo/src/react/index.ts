import type { QueryHandle, QueryTypes, RegisteredQueries } from "../queries";

import { createContext, createElement, useContext, useState, type ReactNode } from "react";

import {
  createSilo,
  type DocumentHandle,
  type DocumentTypes,
  type RegisteredTypes,
  type Silo,
  type SiloConfig,
} from "../store";
import { SiloContext } from "./context";

/**
 * Extract the document-types map `M` from a `Silo<M, Q>` type.
 */
export type ModelsOf<S> = S extends Silo<infer M, QueryTypes> ? M : never;

/**
 * Extract the query-types map `Q` from a `Silo<M, Q>` type.
 */
export type QueriesOf<S> = S extends Silo<DocumentTypes, infer Q> ? Q : never;

/**
 * Optional declarative seed data for a Provider. `model` keys docs by id;
 * `query` keys results by their params object (a list since params aren't
 * natural dict keys).
 */
export interface InitialSiloData<M extends DocumentTypes, Q extends QueryTypes> {
  model?: { [K in keyof M]?: Record<string, M[K]> };
  query?: {
    [K in keyof Q]?: ReadonlyArray<{ params: Q[K]["params"]; result: Q[K]["result"] }>;
  };
}

function seedModels<M extends DocumentTypes, Q extends QueryTypes>(
  store: Silo<M, Q>,
  models: NonNullable<InitialSiloData<M, Q>["model"]>,
): void {
  for (const type of Object.keys(models) as Array<keyof M & string>) {
    const bucket = models[type];
    if (bucket) {
      for (const id of Object.keys(bucket)) {
        const doc = bucket[id];
        if (doc) store.insertDocument(type, doc);
      }
    }
  }
}

function seedQueries<M extends DocumentTypes, Q extends QueryTypes>(
  store: Silo<M, Q>,
  queries: NonNullable<InitialSiloData<M, Q>["query"]>,
): void {
  for (const type of Object.keys(queries) as Array<keyof Q & string>) {
    const list = queries[type];
    if (list) {
      for (const entry of list) {
        store.insertQueryResult(type, entry.params, entry.result);
      }
    }
  }
}

/**
 * Create an isolated silo React binding — Context + Provider + hooks,
 * all tied to a fresh React Context that doesn't collide with any other call
 * to this factory.
 *
 * Mirrors `createGranaryContext<T>()` from `@supergrain/kernel/react`: the type
 * parameter `S` is the full store type; the Provider takes the same `config`
 * you'd pass to `createSilo` and constructs the store internally
 * exactly once per mount. Every SSR request, every test, every React tree
 * gets an isolated store by construction.
 *
 * Optional `initial` seeds documents and query results before the first
 * render. Optional `onMount` runs synchronously after seeding for imperative
 * setup (preloads, subscriptions). Both run inside the `useState`
 * initializer, so under React StrictMode in dev they are double-invoked —
 * keep them idempotent.
 *
 * @example
 * ```tsx
 * type AppSilo = Silo<TypeToModel, TypeToQuery>;
 * export const { Provider, useSilo, useDocument, useQuery } =
 *   createSiloContext<AppSilo>();
 *
 * <Provider config={{ models, queries }} onMount={(store) => store.find("user", "1")}>
 *   <App />
 * </Provider>
 * ```
 */
export function createSiloContext<
  S extends Silo<DocumentTypes, QueryTypes> = Silo<RegisteredTypes, RegisteredQueries>,
>(): {
  Provider: (props: {
    config: SiloConfig<ModelsOf<S>, QueriesOf<S>>;
    initial?: InitialSiloData<ModelsOf<S>, QueriesOf<S>>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }) => ReactNode;
  useSilo: () => S;
  useDocument: <K extends keyof ModelsOf<S> & string>(
    type: K,
    id: string | null | undefined,
  ) => DocumentHandle<ModelsOf<S>[K]>;
  useQuery: <K extends keyof QueriesOf<S> & string>(
    type: K,
    params: QueriesOf<S>[K]["params"] | null | undefined,
  ) => QueryHandle<QueriesOf<S>[K]["result"]>;
} {
  type M = ModelsOf<S>;
  type Q = QueriesOf<S>;

  const Context = createContext<S | null>(null);

  function Provider({
    config,
    initial,
    onMount,
    children,
  }: {
    config: SiloConfig<M, Q>;
    initial?: InitialSiloData<M, Q>;
    onMount?: (store: S) => void;
    children: ReactNode;
  }): ReactNode {
    const [store] = useState<S>(() => {
      const s = createSilo<M, Q>(config);
      if (initial?.model) seedModels(s, initial.model);
      if (initial?.query) seedQueries(s, initial.query);
      const sAsS = s as unknown as S;
      onMount?.(sAsS);
      return sAsS;
    });
    return createElement(
      Context.Provider,
      { value: store },
      createElement(
        SiloContext.Provider,
        { value: store as unknown as Silo<DocumentTypes, QueryTypes> },
        children,
      ),
    );
  }

  function useSilo(): S {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(
        "@supergrain/silo/react: useSilo must be used within the Provider returned by createSiloContext()",
      );
    }
    return store;
  }

  function useDocument<K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ): DocumentHandle<M[K]> {
    const store = useSilo() as unknown as Silo<M, Q>;
    // oxlint-disable-next-line no-array-method-this-argument -- Silo#find, not Array#find
    return store.find(type, id);
  }

  function useQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]> {
    const store = useSilo() as unknown as Silo<M, Q>;
    return store.findQuery(type, params);
  }

  return { Provider, useSilo, useDocument, useQuery };
}
