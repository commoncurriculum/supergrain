import { describe, it, expect } from "vitest";

import { createFakeAdapter, createFakeQueryAdapter } from "../src";

// =============================================================================
// createFakeAdapter
// =============================================================================

interface User {
  firstName: string;
}

describe("createFakeAdapter", () => {
  it("returns seeded data by id", async () => {
    const fake = createFakeAdapter<User>({
      "1": { firstName: "Alice" },
      "2": { firstName: "Bob" },
    });

    const res = await fake.adapter.find(["1", "2"]);

    expect(res.data).toHaveLength(2);
    expect(res.data[0].id).toBe("1");
    expect(res.data[0].attributes.firstName).toBe("Alice");
    expect(res.data[1].attributes.firstName).toBe("Bob");
  });

  it("omits docs for unseeded ids (returns partial response)", async () => {
    const fake = createFakeAdapter<User>({ "1": { firstName: "Alice" } });

    const res = await fake.adapter.find(["1", "missing"]);

    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("1");
  });

  it("records each find() call in order", async () => {
    const fake = createFakeAdapter<User>({ "1": { firstName: "A" } });

    await fake.adapter.find(["1"]);
    await fake.adapter.find(["1", "2"]);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toEqual(["1"]);
    expect(fake.calls[1]).toEqual(["1", "2"]);
    expect(fake.allRequestedIds).toEqual(["1", "1", "2"]);
  });

  it("setData updates existing and adds new entries", async () => {
    const fake = createFakeAdapter<User>({ "1": { firstName: "Alice" } });

    fake.setData("1", { firstName: "Alicia" });
    fake.setData("2", { firstName: "Bob" });

    const res = await fake.adapter.find(["1", "2"]);
    expect(res.data[0].attributes.firstName).toBe("Alicia");
    expect(res.data[1].attributes.firstName).toBe("Bob");
  });

  it("setError causes find() to reject when the id is requested", async () => {
    const fake = createFakeAdapter<User>({ "1": { firstName: "Alice" } });

    fake.setError("1", new Error("nope"));

    await expect(fake.adapter.find(["1"])).rejects.toThrow("nope");
  });

  it("setError on one id rejects batches containing that id", async () => {
    const fake = createFakeAdapter<User>({
      "1": { firstName: "A" },
      "2": { firstName: "B" },
    });

    fake.setError("2", new Error("bad batch"));

    await expect(fake.adapter.find(["1", "2"])).rejects.toThrow("bad batch");
  });

  it("clear(id) removes both data and errors for that id", async () => {
    const fake = createFakeAdapter<User>();

    fake.setError("1", new Error("bad"));
    fake.clear("1");
    fake.setData("1", { firstName: "Fresh" });

    const res = await fake.adapter.find(["1"]);
    expect(res.data[0].attributes.firstName).toBe("Fresh");
  });

  it("reset() clears everything including call history", async () => {
    const fake = createFakeAdapter<User>({ "1": { firstName: "A" } });
    await fake.adapter.find(["1"]);
    expect(fake.calls).toHaveLength(1);

    fake.reset();

    expect(fake.calls).toHaveLength(0);
    const res = await fake.adapter.find(["1"]);
    expect(res.data).toHaveLength(0);
  });
});

// =============================================================================
// createFakeQueryAdapter
// =============================================================================

describe("createFakeQueryAdapter", () => {
  it("returns the initial response on fetch", async () => {
    const fake = createFakeQueryAdapter({
      data: [{ type: "post", id: "10" }],
      included: [],
      nextOffset: null,
    });

    const res = await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });

    expect(res.data).toEqual([{ type: "post", id: "10" }]);
  });

  it("defaults to an empty response when no response is provided", async () => {
    const fake = createFakeQueryAdapter();

    const res = await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });

    expect(res.data).toEqual([]);
    expect(res.nextOffset).toBeNull();
  });

  it("records every call with the ResolvedQueryDef", async () => {
    const fake = createFakeQueryAdapter();

    await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });
    await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 10, limit: 10 },
    });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].page.offset).toBe(0);
    expect(fake.calls[1].page.offset).toBe(10);
  });

  it("setResponse swaps the response for subsequent calls", async () => {
    const fake = createFakeQueryAdapter({
      data: [{ type: "post", id: "10" }],
      included: [],
      nextOffset: null,
    });

    fake.setResponse({
      data: [{ type: "post", id: "99" }],
      included: [],
      nextOffset: null,
    });

    const res = await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });

    expect(res.data[0].id).toBe("99");
  });

  it("setError causes the next fetch to reject, then clears", async () => {
    const fake = createFakeQueryAdapter({
      data: [],
      included: [],
      nextOffset: null,
    });

    fake.setError(new Error("network"));

    await expect(
      fake.adapter.fetch({
        type: "feed",
        id: "u1",
        page: { offset: 0, limit: 10 },
      }),
    ).rejects.toThrow("network");

    // Subsequent fetch works again
    const res = await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });
    expect(res.data).toEqual([]);
  });

  it("reset() clears calls and queued errors", async () => {
    const fake = createFakeQueryAdapter();

    await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });
    fake.setError(new Error("x"));

    fake.reset();

    expect(fake.calls).toHaveLength(0);
    // Error should be cleared
    const res = await fake.adapter.fetch({
      type: "feed",
      id: "u1",
      page: { offset: 0, limit: 10 },
    });
    expect(res).toBeDefined();
  });
});
