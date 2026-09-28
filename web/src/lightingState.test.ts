import { describe, expect, it } from "vitest";
import { LightingTransition, exposure, emissionStrength, lateEmission, sunToward, sunStrength } from "./lightingState";

describe("transitions (Review Focus 1)", () => {
  it("reaches the target in ~1 s", () => {
    const t = new LightingTransition("golden");
    t.request("night");
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(1, 6);
  });
  it("settles when a transition completes with nothing pending (from = to, blend = 1)", () => {
    const t = new LightingTransition("golden");
    t.request("night");
    for (let i = 0; i < 59; i++) t.update(1 / 60);
    expect(t.from).toBe("golden");
    for (let i = 0; i < 5; i++) t.update(1 / 60);
    expect([t.from, t.to, t.blend]).toEqual(["night", "night", 1]);
    expect(t.night).toBe(1);
    t.request("golden");
    expect([t.from, t.to, t.blend]).toEqual(["night", "golden", 0]);
  });
  it("a queued state still plays, then settles on it", () => {
    const t = new LightingTransition("golden");
    t.request("night");
    t.update(0.3);
    t.request("golden");
    for (let i = 0; i < 180; i++) t.update(1 / 60);
    expect([t.from, t.to, t.blend]).toEqual(["golden", "golden", 1]);
  });
  it("reversal mid-way continues from the current value (no jump)", () => {
    const t = new LightingTransition("golden");
    t.request("night");
    for (let i = 0; i < 18; i++) t.update(1 / 60);
    const before = t.night;
    t.request("golden");
    expect(t.night).toBeCloseTo(before, 6);
    for (let i = 0; i < 120; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(0.6, 6);
  });
  it("third state is queued; values stay continuous and end at golden", () => {
    const t = new LightingTransition("golden");
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

import { missingLightmaps, envSizeMismatch } from "./lightingState";

describe("lightmaps-present flag (fix round 1)", () => {
  const full = { golden: { bowl: 1, site: 1 }, night: { bowl: 1, site: 1 } };
  it("complete bake -> nothing missing", () => {
    expect(missingLightmaps(full, ["bowl", "site"])).toEqual([]);
  });
  it("no bake -> everything missing", () => {
    const none = { golden: {}, night: {} };
    expect(missingLightmaps(none, ["bowl"])).toEqual(["golden/bowl", "night/bowl"]);
  });
  it("partial bake names what is missing, including groups only some states have", () => {
    const partial = { golden: { bowl: 1 }, night: { bowl: 1, extra: 1 } };
    expect(missingLightmaps(partial, ["bowl", "site"])).toEqual(["golden/site", "golden/extra", "night/site"]);
  });
  it("no groups at all counts as missing", () => {
    expect(missingLightmaps({ golden: {}, night: {} }, [])).toEqual(["(no lightmap groups)"]);
  });
  it("lazy states: only the loaded ones are checked", () => {
    expect(missingLightmaps({ night: { bowl: 1 } }, ["bowl"])).toEqual([]);
    expect(missingLightmaps({ golden: {} }, ["bowl"])).toEqual(["golden/bowl"]);
  });
});

describe("env size check (fix round 1)", () => {
  it("same size -> null", () => {
    expect(envSizeMismatch([{ width: 1024, height: 512 }, { width: 1024, height: 512 }, { width: 1024, height: 512 }])).toBeNull();
  });
  it("different size -> message naming the sizes", () => {
    expect(envSizeMismatch([{ width: 1024, height: 512 }, { width: 2048, height: 1024 }, { width: 1024, height: 512 }])).toMatch(/2048x1024/);
  });
});

it("v4: city windows fade in only toward night", () => {
  expect(lateEmission(0)).toBe(0);
  expect(lateEmission(0.6)).toBe(0);      // golden hour: off
  expect(lateEmission(1)).toBe(1);
  expect(lateEmission(0.8)).toBeCloseTo(0.5, 5);
});
