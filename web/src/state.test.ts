import { describe, expect, it } from "vitest";
import { reduce, initialState } from "./state";

describe("app state", () => {
  it("overview -> section -> back to overview", () => {
    let s = reduce(initialState, { type: "section", section: 212 });
    expect(s.view).toEqual({ kind: "section", section: 212 });
    s = reduce(s, { type: "back" });
    expect(s.view).toEqual({ kind: "overview" });
  });
  it("another section while zoomed re-targets; the same section again is a no-op (Review Focus 5)", () => {
    const s = reduce(initialState, { type: "section", section: 101 });
    expect(reduce(s, { type: "section", section: 102 }).view).toEqual({ kind: "section", section: 102 });
    expect(reduce(s, { type: "section", section: 101 })).toBe(s);
  });
  it("empty-space click and back from overview change nothing", () => {
    expect(reduce(initialState, { type: "none" })).toBe(initialState);
    expect(reduce(initialState, { type: "back" })).toBe(initialState);
  });
  it("lighting is independent of view", () => {
    const s = reduce(reduce(initialState, { type: "section", section: 7 }), { type: "lighting", lighting: "night" });
    expect(s.lighting).toBe("night");
    expect(s.view.kind).toBe("section");
  });
});
