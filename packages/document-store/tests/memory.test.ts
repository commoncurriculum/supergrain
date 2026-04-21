import { describe, it, expect } from "vitest";

import { MemoryEngine } from "../src/memory";
import { makePost, makeUser, type TypeToModel } from "./example-app";

// =============================================================================
// insert + find
// =============================================================================

describe("MemoryEngine.insert + find", () => {
  it("inserts a document that can be retrieved by find", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("1");

    memory.insert(user);

    expect(memory.find("user", "1")).toBe(user);
  });

  it("returns undefined for a document not in memory", () => {
    const memory = new MemoryEngine<TypeToModel>();

    expect(memory.find("user", "999")).toBeUndefined();
  });

  it("overwrites an existing document with the same type and id (last-write-wins)", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert(makeUser("1", { firstName: "Alice" }));
    memory.insert(makeUser("1", { firstName: "Bob" }));

    expect(memory.find("user", "1")?.attributes.firstName).toBe("Bob");
  });

  it("stores documents of different types independently", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("1");
    const post = makePost("1");

    memory.insert(user);
    memory.insert(post);

    expect(memory.find("user", "1")).toBe(user);
    expect(memory.find("post", "1")).toBe(post);
  });

  it("keys by both type and id (same id across types does not collide)", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("shared");
    const post = makePost("shared");

    memory.insert(user);
    memory.insert(post);

    expect(memory.find("user", "shared")).toBe(user);
    expect(memory.find("post", "shared")).toBe(post);
  });
});

// =============================================================================
// clear
// =============================================================================

describe("MemoryEngine.clear", () => {
  it("drops all documents", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert(makeUser("1"));
    memory.insert(makeUser("2"));
    memory.insert(makePost("1"));
    memory.clear();

    expect(memory.find("user", "1")).toBeUndefined();
    expect(memory.find("user", "2")).toBeUndefined();
    expect(memory.find("post", "1")).toBeUndefined();
  });

  it("allows new inserts after clear", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert(makeUser("1", { firstName: "Before" }));
    memory.clear();
    memory.insert(makeUser("1", { firstName: "After" }));

    expect(memory.find("user", "1")?.attributes.firstName).toBe("After");
  });
});
