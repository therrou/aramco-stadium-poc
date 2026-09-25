import { describe, expect, it } from "vitest";
import { reduce, initialState } from "./state";

const A = { section: 212, row: 10, seat: 4 }, B = { section: 212, row: 10, seat: 5 };
describe("app state (v2: overview | seat)", () => {
  it("overview -> seat -> back", () => {
    let s = reduce(initialState, { type: "seat", seat: A });
    expect(s.view).toEqual({ kind: "seat", seat: A });
    s = reduce(s, { type: "back" });
    expect(s.view).toEqual({ kind: "overview" });
  });
  it("another seat re-targets; the same seat again is a no-op", () => {
    const s = reduce(initialState, { type: "seat", seat: A });
    expect(reduce(s, { type: "seat", seat: B }).view).toEqual({ kind: "seat", seat: B });
    expect(reduce(s, { type: "seat", seat: { ...A } })).toBe(s);
  });
  it("empty-space click and back from overview change nothing", () => {
    expect(reduce(initialState, { type: "none" })).toBe(initialState);
    expect(reduce(initialState, { type: "back" })).toBe(initialState);
  });
  it("lighting keeps the seat view (Review Focus 3)", () => {
    const s = reduce(reduce(initialState, { type: "seat", seat: A }), { type: "lighting", lighting: "night" });
    expect(s.lighting).toBe("night");
    expect(s.view.kind).toBe("seat");
  });
  it("a named camera goes to overview, stops auto orbit, and re-flies even if repeated", () => {
    const s = reduce(reduce(initialState, { type: "autoOrbit", on: true }), { type: "camera", camera: "CAM_Top" });
    expect(s.view.kind).toBe("overview");
    expect(s.autoOrbit).toBe(false);
    expect(reduce(s, { type: "camera", camera: "CAM_Top" })).not.toBe(s);
  });
  it("auto orbit only in overview (Review Focus 3); choosing a seat stops it", () => {
    const seat = reduce(initialState, { type: "seat", seat: A });
    expect(reduce(seat, { type: "autoOrbit", on: true })).toBe(seat);
    const orbit = reduce(initialState, { type: "autoOrbit", on: true });
    expect(orbit.autoOrbit).toBe(true);
    expect(reduce(orbit, { type: "autoOrbit", on: true })).toBe(orbit);
    expect(reduce(orbit, { type: "seat", seat: A }).autoOrbit).toBe(false);
  });
});

import { parseLighting } from "./state";
describe("?state= param (fix round 1)", () => {
  it("accepts day/golden/night", () => {
    expect(parseLighting("day")).toBe("day");
    expect(parseLighting("golden")).toBe("golden");
    expect(parseLighting("night")).toBe("night");
  });
  it("falls back to the initial lighting otherwise", () => {
    expect(parseLighting(null)).toBe(initialState.lighting);
    expect(parseLighting("dusk")).toBe(initialState.lighting);
    expect(parseLighting("")).toBe(initialState.lighting);
  });
});
