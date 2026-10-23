import { describe, it, expect } from "vitest";

import { createReactive, effect, reconcile, unwrap } from "../../src";

function runs(read: () => unknown): { count: number } {
  const counter = { count: 0 };
  effect(() => {
    read();
    counter.count++;
  });
  counter.count = 0;
  return counter;
}

describe("reconcile", () => {
  it("updates a plain object in place, notifying only the fields that changed", () => {
    const state = createReactive({
      user: { name: "Ada", visits: 1, address: { city: "London" }, nickname: "A" } as {
        name: string;
        visits: number;
        address: { city: string };
        nickname?: string;
      },
    });
    const user = state.user;
    const address = state.user.address;
    const name = runs(() => state.user.name);
    const visits = runs(() => state.user.visits);
    const city = runs(() => state.user.address.city);
    const nickname = runs(() => state.user.nickname);

    const kept = reconcile(state.user, { name: "Ada", visits: 2, address: { city: "London" } });

    expect(kept).toBe(user);
    expect(state.user).toBe(user);
    expect(state.user.address).toBe(address);
    expect(unwrap(state.user)).toEqual({ name: "Ada", visits: 2, address: { city: "London" } });
    expect(name.count).toBe(0);
    expect(visits.count).toBe(1);
    expect(city.count).toBe(0);
    expect(nickname.count).toBe(1);
  });

  it("matches arrays of objects by id, so a moved item keeps its object", () => {
    const state = createReactive({
      rows: [
        { id: "a", total: 1 },
        { id: "b", total: 2 },
        { id: "c", total: 3 },
      ],
    });
    const [rowA, rowB] = state.rows;
    const totalA = runs(() => rowA!.total);
    const totalB = runs(() => rowB!.total);

    reconcile(state.rows, [
      { id: "b", total: 2 },
      { id: "a", total: 10 },
    ]);

    expect(state.rows.map((row) => row.id)).toEqual(["b", "a"]);
    expect(state.rows[0]).toBe(rowB);
    expect(state.rows[1]).toBe(rowA);
    expect(rowA!.total).toBe(10);
    expect(totalA.count).toBe(1);
    expect(totalB.count).toBe(0);
  });

  it("matches other arrays by index", () => {
    const state = createReactive({ points: [{ x: 1 }, { x: 2 }, { x: 3 }], tags: ["a", "b"] });
    const first = state.points[0];
    const firstX = runs(() => state.points[0]!.x);
    const secondX = runs(() => state.points[1]!.x);

    reconcile(state.points, [{ x: 1 }, { x: 20 }]);
    reconcile(state.tags, ["a", "b", "c"]);

    expect(state.points[0]).toBe(first);
    expect(unwrap(state.points)).toEqual([{ x: 1 }, { x: 20 }]);
    expect(firstX.count).toBe(0);
    expect(secondX.count).toBe(1);
    expect(unwrap(state.tags)).toEqual(["a", "b", "c"]);
  });

  it("returns next when the two can't be reconciled", () => {
    const next = { name: "Grace" };
    const date = new Date(0);

    expect(reconcile(undefined, next)).toBe(next);
    expect(reconcile(1, 2)).toBe(2);
    expect(reconcile<unknown>([1], next)).toBe(next);
    expect(reconcile(new Date(1), date)).toBe(date);
  });
});
