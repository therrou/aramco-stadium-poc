import { describe, expect, it } from "vitest";
import { DPR, DprGovernor } from "./perf";

const run = (g: DprGovernor, dt: number, s: number) => { const out: number[] = []; for (let t = 0; t < s; t += dt) { const r = g.sample(dt); if (r) out.push(r); } return out; };

describe("adaptive pixel ratio", () => {
  it("a fast GPU keeps its pixel ratio", () => {
    expect(run(new DprGovernor(2), 1 / 60, 30)).toEqual([]);
  });
  it("a slow GPU steps 2 -> 1.5 -> 1 and stops there", () => {
    const g = new DprGovernor(2);
    expect(run(g, 1 / 20, 60)).toEqual([1.5, 1]);
    expect(g.dpr).toBe(1);
  });
  it("loading hitches in the grace period are ignored", () => {
    const g = new DprGovernor(2);
    expect(run(g, 0.5, DPR.graceS - 0.5)).toEqual([]);
    expect(run(g, 1 / 60, 20)).toEqual([]);
  });
  it("a DPR-1 display has nowhere to go", () => {
    expect(run(new DprGovernor(1), 1 / 10, 30)).toEqual([]);
  });
});
