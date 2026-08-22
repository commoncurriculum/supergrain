// Verifies the behavioural claims made by .claude/skills/supergrain/SKILL.md
// about @supergrain/mill. Named after the skill sentence each one backs.

import { createReactive } from "@supergrain/kernel";
import { update } from "@supergrain/mill";
import { describe, expect, it } from "vitest";

describe('SKILL: "`doc` is the same object back"', () => {
  it("update mutates in place and returns the very same reference", () => {
    const doc = createReactive({ meta: { title: "before" }, unsaved: false });

    const result = update(doc, {}, { $set: { "meta.title": "after", unsaved: true } });

    expect(result.doc).toBe(doc);
    expect(doc.meta.title).toBe("after");
    expect(doc.unsaved).toBe(true);
  });
});

describe('SKILL: "`undo` is an inverse Mongo update document — not a function"', () => {
  it("undo is not callable, and replaying it through update() restores the prior state", () => {
    const doc = createReactive({ meta: { title: "before" }, unsaved: false });

    const { undo } = update(doc, {}, { $set: { "meta.title": "after", unsaved: true } });

    // The shape agents reach for — `undo()` — is not available.
    expect(typeof undo).not.toBe("function");
    expect(undo).toEqual({ $set: { "meta.title": "before", unsaved: false } });

    update(doc, {}, undo);

    expect(doc.meta.title).toBe("before");
    expect(doc.unsaved).toBe(false);
  });
});
