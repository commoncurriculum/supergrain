import { createReactive, unwrap } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { update } from "../src";

// Mill never decides a document's prototype flavor — it follows it. These
// tests pin the two places that could silently impose `Object.prototype` on a
// null-prototype document: undo snapshots (which must restore the prior state
// *exactly*, prototype included) and fabricated intermediate branches (which
// must match the document they're created in). Prototypes don't exist in BSON,
// so none of this goes through the mongo oracle — raw `update` only.

function nullProto<T extends Record<string, unknown>>(entries: T): T {
  const out = Object.create(null) as T;
  for (const key of Object.keys(entries)) {
    (out as Record<string, unknown>)[key] = entries[key];
  }
  return out;
}

function protoOf(value: unknown): object | null {
  return Object.getPrototypeOf(value) as object | null;
}

describe("undo snapshots preserve prototype flavor", () => {
  it("$set overwrite of a null-prototype object restores it null-prototype", () => {
    const store = createReactive(
      nullProto({ attributes: nullProto({ nested: nullProto({ value: 1 }) }) }),
    );

    const { undo } = update(store, {}, { $set: { attributes: { replaced: true } } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.attributes.nested.value).toBe(1);
    expect(protoOf(raw.attributes)).toBeNull();
    expect(protoOf(raw.attributes.nested)).toBeNull();
  });

  it("$set overwrite of a plain object restores it plain", () => {
    const store = createReactive({ attributes: { nested: { value: 1 } } });

    const { undo } = update(store, {}, { $set: { attributes: { replaced: true } } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(protoOf(raw.attributes)).toBe(Object.prototype);
    expect(protoOf(raw.attributes.nested)).toBe(Object.prototype);
  });

  it("$pop restores a null-prototype element null-prototype", () => {
    const store = createReactive(nullProto({ items: [nullProto({ id: "a" })] }));

    const { undo } = update(store, {}, { $pop: { items: 1 } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.items).toEqual([{ id: "a" }]);
    expect(protoOf(raw.items[0])).toBeNull();
  });

  it("$pull restores removed null-prototype elements null-prototype", () => {
    const store = createReactive(
      nullProto({ items: [nullProto({ id: "a" }), nullProto({ id: "b" })] }),
    );

    const { undo } = update(store, {}, { $pull: { items: { id: "a" } } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(protoOf(raw.items[0])).toBeNull();
    expect(protoOf(raw.items[1])).toBeNull();
  });

  it("restores Dates as Dates", () => {
    const when = new Date("2026-01-02T03:04:05Z");
    const store = createReactive({ at: when });

    const { undo } = update(store, {}, { $set: { at: new Date(0) } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.at).toBeInstanceOf(Date);
    expect(raw.at.getTime()).toBe(when.getTime());
    expect(raw.at).not.toBe(when); // snapshot, not the live reference
  });

  it("preserves shared references within one snapshot", () => {
    const shared = { id: "s" };
    const store = createReactive({ items: [shared, shared] });

    const { undo } = update(store, {}, { $set: { items: [] } } as never);
    update(store, {}, undo);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.items[0]).toBe(raw.items[1]);
  });
});

describe("fabricated intermediate branches match the document's flavor", () => {
  it("a null-prototype document grows null-prototype branches", () => {
    const store = createReactive(nullProto({}) as Record<string, unknown>);

    update(store, {}, { $set: { "a.b.c": 1 } } as never);

    const raw = unwrap(store) as Record<string, any>;
    expect(raw.a.b.c).toBe(1);
    expect(protoOf(raw.a)).toBeNull();
    expect(protoOf(raw.a.b)).toBeNull();
  });

  it("a plain document grows plain branches", () => {
    const store = createReactive({} as Record<string, unknown>);

    update(store, {}, { $set: { "a.b.c": 1 } } as never);

    const raw = unwrap(store) as Record<string, any>;
    expect(protoOf(raw.a)).toBe(Object.prototype);
    expect(protoOf(raw.a.b)).toBe(Object.prototype);
  });
});
