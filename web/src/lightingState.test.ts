import { describe, expect, it } from "vitest";
import { LightingTransition, exposure, emissionStrength, sunToward, sunStrength } from "./lightingState";

describe("transitions (Review Focus 1)", () => {
  it("reaches the target in ~1 s", () => {
    const t = new LightingTransition("day");
    t.request("night");
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(1, 6);
  });
  it("reversal mid-way continues from the current value (no jump)", () => {
    const t = new LightingTransition("day");
    t.request("night");
    for (let i = 0; i < 18; i++) t.update(1 / 60);
    const before = t.night;
    t.request("day");
    expect(t.night).toBeCloseTo(before, 6);
    for (let i = 0; i < 120; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(0, 6);
  });
  it("third state is queued; values stay continuous and end at golden", () => {
    const t = new LightingTransition("day");
    t.request("night");
    let prev = t.night, maxStep = 0;
    for (let i = 0; i < 240; i++) {
      if (i === 18) t.request("golden");
      t.update(1 / 60);
      maxStep = Math.max(maxStep, Math.abs(t.night - prev));
      prev = t.night;
    }
    expect(t.to).toBe("golden");
    expect(t.night).toBeCloseTo(0.6, 6);
    expect(maxStep).toBeLessThan(0.12);
  });
});

describe("Blender formulas", () => {
  it("exposure = 2^(0.25 + 0.5 n + e)", () => {
    expect(exposure(0, 0)).toBeCloseTo(2 ** 0.25);
    expect(exposure(1, -0.4)).toBeCloseTo(2 ** 0.35);
  });
  it("emission day + n (night - day)", () => {
    expect(emissionStrength(0.3, 5, 0)).toBe(0.3);
    expect(emissionStrength(0.3, 5, 0.6)).toBeCloseTo(3.12);
  });
  it("sun: SW at day, WNW and 2 deg high at golden, off at night", () => {
    const d = sunToward(0);
    expect(d[0]).toBeLessThan(0); expect(d[1]).toBeLessThan(0);
    expect(Math.asin(d[2]) * 180 / Math.PI).toBeCloseTo(24, 4);
    const g = sunToward(0.6);
    expect(Math.asin(g[2]) * 180 / Math.PI).toBeCloseTo(2, 4);
    expect(g[0]).toBeLessThan(0); expect(g[1]).toBeGreaterThan(0);
    expect(sunStrength(1)).toBe(0);
  });
});
