import { effect } from "@supergrain/core";
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

    memory.insert("user", user);

    expect(memory.find("user", "1")).toBe(user);
  });

  it("returns undefined for a document not in memory", () => {
    const memory = new MemoryEngine<TypeToModel>();

    expect(memory.find("user", "999")).toBeUndefined();
  });

  it("overwrites an existing document with the same type and id (last-write-wins)", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert("user", makeUser("1", { firstName: "Alice" }));
    memory.insert("user", makeUser("1", { firstName: "Bob" }));

    expect(memory.find("user", "1")?.attributes.firstName).toBe("Bob");
  });

  it("stores documents of different types independently", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("1");
    const post = makePost("1");

    memory.insert("user", user);
    memory.insert("post", post);

    expect(memory.find("user", "1")).toBe(user);
    expect(memory.find("post", "1")).toBe(post);
  });

  it("keys by both type and id (same id across types does not collide)", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("shared");
    const post = makePost("shared");

    memory.insert("user", user);
    memory.insert("post", post);

    expect(memory.find("user", "shared")).toBe(user);
    expect(memory.find("post", "shared")).toBe(post);
  });

  it("stores documents with no `type` field — library only needs `id`", () => {
    // `User` in example-app has no `type` field. MemoryEngine keys by the
    // externally-supplied type arg, never by reading a field on the doc.
    const memory = new MemoryEngine<TypeToModel>();
    const user = makeUser("1");
    expect("type" in user).toBe(false);

    memory.insert("user", user);

    expect(memory.find("user", "1")).toBe(user);
  });
});

// =============================================================================
// clear
// =============================================================================

describe("MemoryEngine.clear", () => {
  it("drops all documents", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert("user", makeUser("1"));
    memory.insert("user", makeUser("2"));
    memory.insert("post", makePost("1"));
    memory.clear();

    expect(memory.find("user", "1")).toBeUndefined();
    expect(memory.find("user", "2")).toBeUndefined();
    expect(memory.find("post", "1")).toBeUndefined();
  });

  it("allows new inserts after clear", () => {
    const memory = new MemoryEngine<TypeToModel>();

    memory.insert("user", makeUser("1", { firstName: "Before" }));
    memory.clear();
    memory.insert("user", makeUser("1", { firstName: "After" }));

    expect(memory.find("user", "1")?.attributes.firstName).toBe("After");
  });
});

// =============================================================================
// Reactivity — find() reads subscribe to the (type,id) key. Spec: reads inside
// a tracked scope re-run on later insert/clear at that key.
// =============================================================================

describe("MemoryEngine reactivity", () => {
  it("re-runs effects reading a key when that key is inserted", () => {
    const memory = new MemoryEngine<TypeToModel>();
    const reads: Array<string | undefined> = [];

    const stop = effect(() => {
      reads.push(memory.find("user", "1")?.attributes.firstName);
    });

    memory.insert("user", makeUser("1", { firstName: "First" }));
    memory.insert("user", makeUser("1", { firstName: "Second" }));

    expect(reads).toEqual([undefined, "First", "Second"]);
    stop();
  });

  it("does not re-run effects reading a different key", () => {
    const memory = new MemoryEngine<TypeToModel>();
    let runs = 0;

    const stop = effect(() => {
      memory.find("user", "other");
      runs++;
    });
    const initialRuns = runs;

    memory.insert("user", makeUser("1"));

    expect(runs).toBe(initialRuns);
    stop();
  });

  it("clear() re-runs reading effects in a single batch, not once per key", () => {
    const memory = new MemoryEngine<TypeToModel>();
    memory.insert("user", makeUser("1"));
    memory.insert("user", makeUser("2"));
    memory.insert("post", makePost("1"));

    let runs = 0;
    const stop = effect(() => {
      // Read every cleared key. If clear fired per-key notifications instead
      // of a single batch, this effect would re-run N times, not once.
      memory.find("user", "1");
      memory.find("user", "2");
      memory.find("post", "1");
      runs++;
    });
    const initialRuns = runs;

    memory.clear();

    expect(runs).toBe(initialRuns + 1);
    stop();
  });
});
