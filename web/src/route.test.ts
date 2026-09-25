import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocked, isInside, planFlight, flightSeconds, FLIGHT_MIN_S, FLIGHT_MAX_S } from "./route";
import { seatViewPose, type Pose } from "./flyto";
import type { SectionsDoc } from "./loader";
import type { V3 } from "./coords";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));
// Blender cameras (web/public/assets/cameras.json), copied so the tests need no built assets
const CAM: Record<string, Pose> = {
  aerialSW: { eye: [-330, -470, 230], target: [-276.7634, -392.5649, 195.7995], hfov: 46.4 },
  approach: { eye: [-45.5818, -228.6689, 1.7], target: [-26.1217, -131.0438, 11.2205], hfov: 73.7 },
  top: { eye: [0, 0.01, 820], target: [0, 0.0076, 720], hfov: 39.6 },
  bowl: { eye: [54.903, -85.636, 33.444], target: [-10.6811, -14.6731, 7.6956], hfov: 96.7 },
  seat312: { eye: [99.896, -2, 25.871], target: [5.0116, -0.0996, -5.6463], hfov: 62 },
  seat101: { eye: [-2.25, -57.546, 7.427], target: [1.6073, 41.0372, -8.8969], hfov: 62 },
  aerialE: { eye: [520, 120, 260], target: [431.4468, 99.5646, 218.2779], hfov: 43.6 },
};
const seatPoses = doc.sections.map((s) => seatViewPose(s.view.eye.map((v, k) => (k === 2 ? v - 1.2 : v)) as V3));
const norm = (v: number[]) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const dirOf = (p: Pose) => norm(p.target.map((v, k) => v - p.eye[k]));
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a.reduce((s, v, k) => s + v * b[k], 0)));

function samples(from: Pose, to: Pose, n = 240) {
  const f = planFlight(from, to);
  return Array.from({ length: n + 1 }, (_, i) => f.at(i / n));
}
const pairs: [string, Pose, Pose][] = [
  ["aerial -> seat 312 (under the roof)", CAM.aerialSW, seatPoses[doc.sections.findIndex((s) => s.id === "312")]],
  ["approach (ground level) -> bowl", CAM.approach, CAM.bowl],
  ["top -> seat 101", CAM.top, CAM.seat101],
  ["seat 312 -> aerial (Back)", CAM.seat312, CAM.aerialSW],
  ["bowl -> approach", CAM.bowl, CAM.approach],
  ["seat 101 -> seat 312 (inside -> inside)", CAM.seat101, CAM.seat312],
  ["aerial SW -> aerial E (outside -> outside)", CAM.aerialSW, CAM.aerialE],
  ["approach -> aerial E", CAM.approach, CAM.aerialE],
];

describe("flight routes (spec v3 C2-C4)", () => {
  it("classifies the poses", () => {
    expect([CAM.aerialSW, CAM.approach, CAM.top].map((p) => isInside(p.eye))).toEqual([false, false, false]);
    expect([CAM.bowl, CAM.seat312, CAM.seat101].map((p) => isInside(p.eye))).toEqual([true, true, true]);
    for (const p of seatPoses) expect(isInside(p.eye)).toBe(true);
  });
  for (const [name, from, to] of pairs) {
    it(`${name}: never passes through the roof, the sails or the shell's base`, () => {
      const bad = samples(from, to).filter((p) => blocked(p.eye));
      expect(bad.map((p) => p.eye.map((v) => v.toFixed(1)).join(","))).toEqual([]);
    });
    it(`${name}: starts and ends exactly on the poses, look direction continuous`, () => {
      const s = samples(from, to);
      expect(s[0].eye).toEqual(from.eye);
      expect(s.at(-1)!.eye).toEqual(to.eye);
      for (let i = 1; i < s.length; i++) expect(angle(dirOf(s[i - 1]), dirOf(s[i]))).toBeLessThan((8 * Math.PI) / 180);
      expect(angle(dirOf(s.at(-1)!), dirOf(to))).toBeLessThan(1e-6);
    });
  }
  it("every section's seat view is reachable from the overview and back without passing through geometry", () => {
    for (const p of seatPoses) {
      for (const [a, b] of [[CAM.aerialSW, p], [p, CAM.aerialSW]] as const) {
        const bad = samples(a, b, 120).filter((q) => blocked(q.eye));
        expect(bad.length).toBe(0);
      }
    }
  });
  it("the seat approach arrives from the pitch side, above the seat, already looking at the pitch (C3)", () => {
    const to = seatPoses[doc.sections.findIndex((s) => s.id === "312")], s = samples(CAM.aerialSW, to);
    const late = s[Math.round(s.length * 0.9)];
    const r = (p: number[]) => Math.hypot(p[0], p[1]);
    expect(r(late.eye)).toBeLessThan(r(to.eye));            // on the pitch side of the seat
    expect(late.eye[2]).toBeGreaterThan(to.eye[2]);           // above it
    expect(angle(dirOf(late), dirOf(to))).toBeLessThan((25 * Math.PI) / 180);
  });
  it("speed is continuous: no sample jumps more than 3x the mean step (C4)", () => {
    for (const [, from, to] of pairs) {
      const s = samples(from, to), steps = s.slice(1).map((p, i) => Math.hypot(...p.eye.map((v, k) => v - s[i].eye[k])));
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      expect(Math.max(...steps)).toBeLessThan(3 * mean + 1e-9);
    }
  });
  it("a long flight gets going quickly: >= 12 % of the way after 20 % of the time, and brakes gently", () => {
    const to = seatPoses[doc.sections.findIndex((x) => x.id === "312")], f = planFlight(CAM.aerialSW, to);
    const s = samples(CAM.aerialSW, to, 400), n = s.length - 1;
    const cum = [0]; for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(...s[i].eye.map((v, k) => v - s[i - 1].eye[k])));
    expect(cum[Math.round(n * 0.2)] / cum[n]).toBeGreaterThan(0.12);
    expect(1 - cum[Math.round(n * 0.95)] / cum[n]).toBeLessThan(0.05);
    expect(f.seconds).toBeGreaterThan(2);
  });
  it("duration scales with length within its bounds (C4)", () => {
    expect(flightSeconds(0)).toBe(FLIGHT_MIN_S);
    expect(flightSeconds(1e6)).toBe(FLIGHT_MAX_S);
    expect(planFlight(CAM.seat101, CAM.seat312).seconds).toBeLessThan(planFlight(CAM.seat101, CAM.aerialSW).seconds);
  });
  it("a direct flight (zoom) is a straight, short move", () => {
    const to = { ...CAM.aerialSW, eye: CAM.aerialSW.eye.map((v, k) => v + (CAM.aerialSW.target[k] - v) * 0.3) as V3 };
    const f = planFlight(CAM.aerialSW, to, { direct: true, seconds: 0.35 });
    expect(f.seconds).toBe(0.35);
    const mid = f.at(0.5).eye;
    expect(mid.every((v, k) => Math.min(CAM.aerialSW.eye[k], to.eye[k]) - 1e-6 <= v && v <= Math.max(CAM.aerialSW.eye[k], to.eye[k]) + 1e-6)).toBe(true);
  });
});
