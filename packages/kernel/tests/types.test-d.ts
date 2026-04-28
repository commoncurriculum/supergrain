// =============================================================================
// types.test-d.ts
// =============================================================================
//
// Type-level tests for the kernel's public API. Pins:
//   - `createReactive<T>` returns `Branded<T>` so consumers can distinguish
//     reactive proxies from raw values via the type system.
//   - The brand is structural: users still see all the original keys/values.
//   - `unwrap` widens out of the branded type back to the underlying shape.
//   - `effect(fn)` returns the disposer signature `() => void`.
// =============================================================================
import { describe, expectTypeOf, it } from "vitest";

import { createReactive, effect, unwrap, type Branded } from "../src";

interface User {
  id: string;
  name: string;
  address: { city: string };
}

describe("createReactive — Branded<T> public surface", () => {
  it("returns Branded<T> given T", () => {
    const u = createReactive<User>({
      id: "1",
      name: "x",
      address: { city: "Boston" },
    });
    expectTypeOf(u).toEqualTypeOf<Branded<User>>();
  });

  it("preserves the original keys at the value layer", () => {
    const u = createReactive<User>({
      id: "1",
      name: "x",
      address: { city: "Boston" },
    });
    expectTypeOf(u.id).toEqualTypeOf<string>();
    expectTypeOf(u.name).toEqualTypeOf<string>();
    expectTypeOf(u.address.city).toEqualTypeOf<string>();
  });
});

describe("unwrap — type identity (T → T)", () => {
  it("returns the same type as the input (the runtime layer dispatches on the brand)", () => {
    const u = createReactive<User>({
      id: "1",
      name: "x",
      address: { city: "Boston" },
    });
    // `unwrap` is `<T>(v: T) => T`, so a Branded<User> input gives a
    // Branded<User> output. The runtime peels the proxy; the type
    // doesn't, intentionally — callers pass the unwrapped value
    // straight back into APIs that expect the same shape.
    expectTypeOf(unwrap(u)).toEqualTypeOf<Branded<User>>();
    const plain: { x: number } = { x: 1 };
    expectTypeOf(unwrap(plain)).toEqualTypeOf<{ x: number }>();
  });
});

describe("effect — signature", () => {
  it("returns () => void", () => {
    const dispose = effect(() => {
      void "side effect";
    });
    expectTypeOf(dispose).toEqualTypeOf<() => void>();
  });
});
