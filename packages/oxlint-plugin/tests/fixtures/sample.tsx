import { useReactivePromise } from "@supergrain/husk/react";
import { batch } from "@supergrain/kernel";
import { tracked, useReactive } from "@supergrain/kernel/react";

// OK: tracked, and the prop is mirrored into reactive state first.
export const Good = tracked(({ id }: { id: string }) => {
  const sel = useReactive({ id });
  if (sel.id !== id) sel.id = id;
  const book = useReactivePromise(async () => fetchBook(sel.id));
  return <div>{book.data?.title}</div>;
});

// BAD: not wrapped in tracked().
export function Untracked() {
  return <span />;
}

// BAD: async callback passed to batch().
export function save(store: { a: number }) {
  batch(async () => {
    store.a = await load();
  });
}

declare function fetchBook(id: string): Promise<{ title: string }>;
declare function load(): Promise<number>;
