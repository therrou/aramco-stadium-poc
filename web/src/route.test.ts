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
  keyVisual: { eye: [-166.2136, -219.5974, 125.0], target: [-113.0485, -151.6183, 74.4796], hfov: 57.2209 },   // v5 Exterior
  approach: { eye: [-45.5818, -228.6689, 1.7], target: [-26.1217, -131.0438, 11.2205], hfov: 73.7 },
  seat201: { eye: [-2.03, -68.389, 11.881], target: [0.8671, 29.1754, -9.8628], hfov: 62 },
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
  ["aerial -> bowl (Stadium button)", CAM.aerialSW, CAM.bowl],
  ["aerial -> centre-line classic (hero)", CAM.aerialSW, CAM.seat201],
  ["bowl -> centre-line classic (opposite side)", CAM.bowl, CAM.seat201],
  ["seat 312 -> seat 101 (across the bowl)", CAM.seat312, CAM.seat101],
  ["aerial -> top", CAM.aerialSW, CAM.top],
  ["bowl -> top", CAM.bowl, CAM.top],
  ["aerial E -> top", CAM.aerialE, CAM.top],
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
      expect(angle(dirOf(s.at(-1)!), dirOf(planFlight(from, to).to))).toBeLessThan(1e-6);
    });
  }
  it("mid-flight the view stays on the pitch centre (user request 2026-09-25)", () => {
    for (const [name, from, to] of pairs) {
      const s = samples(from, to, 400), cum = [0];
      for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(...s[i].eye.map((v, k) => v - s[i - 1].eye[k])));
      for (let i = 0; i < s.length; i++) {
        const f = cum[i] / cum.at(-1)!;
        if (f < 0.25 || f > 0.75) continue;                // the middle half of the way
        const p = s[i], toCentre = norm([-p.eye[0], -p.eye[1], -p.eye[2]]);
        expect(angle(dirOf(p), toCentre), `${name} @${i}`).toBeLessThan((2 * Math.PI) / 180);
      }
    }
  });
  it("mid-flight the view is never steeper than 70 degrees down (no roll flip around the vertical)", () => {
    for (const [name, from, to] of pairs) {
      if (from === CAM.top || to === CAM.top) continue;
      for (const p of samples(from, to, 200).slice(20, 181)) expect(Math.asin(-dirOf(p)[2]), name).toBeLessThan((70 * Math.PI) / 180);
    }
  });
  it("the camera never crosses over the pitch centre: its plan distance to the axis stays >= 20 m mid-flight", () => {
    for (const [name, from, to] of pairs) {
      if (from === CAM.top || to === CAM.top) continue;       // Top view itself sits on the axis
      for (const p of samples(from, to, 200).slice(10, 191)) expect(Math.hypot(p.eye[0], p.eye[1]), name).toBeGreaterThan(20);
    }
  });
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

import { clampOrbit, CameraRig } from "./camera";
describe("final review fixes (routes)", () => {
  const rnd = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  it("any orbit pose the limits allow flies to a seat and to the overview without passing through geometry (review 2)", () => {
    const seat312 = seatPoses[doc.sections.findIndex((s) => s.id === "312")];
    let bad = 0, n = 0;
    for (let i = 0; i < 1500; i++) {
      const tgt: V3 = [(rnd() - 0.5) * 100, (rnd() - 0.5) * 60, rnd() * 5], d = 15 + rnd() * 385;
      const pol = rnd() * (85 * Math.PI / 180), az = rnd() * 2 * Math.PI;
      const eye: V3 = [tgt[0] + d * Math.sin(pol) * Math.cos(az), tgt[1] + d * Math.sin(pol) * Math.sin(az), tgt[2] + d * Math.cos(pol)];
      const c = clampOrbit(eye, tgt), from = { eye: c.eye, target: c.target, hfov: 50 };
      expect(blocked(c.eye), `clamped eye ${c.eye.map((v) => v.toFixed(1))}`).toBe(false);
      for (const to of [seat312, CAM.aerialSW, CAM.keyVisual]) { n++; const b = samples(from, to, 100).find((p) => blocked(p.eye)); if (b) { bad++; if (bad <= 4) console.log("BAD", from.eye.map((v) => v.toFixed(1)).join(","), "->", to === seat312 ? "seat" : "aerial", "at", b.eye.map((v) => v.toFixed(1)).join(",")); } }
    }
    expect(`${bad}/${n}`).toBe(`0/${n}`);
  });
  it("antiparallel start and end views turn about the vertical (a head turn), never through straight up or down", () => {
    const from = { eye: [0, -150, 30] as V3, target: [0, -250, 30] as V3, hfov: 50 };   // looking away from the pitch
    const to = { eye: [0, -150, 30.001] as V3, target: [0, -50, 30.001] as V3, hfov: 50 };
    for (const p of samples(from, to, 100)) expect(Math.abs(dirOf(p)[2])).toBeLessThan(0.7);
  });
  it("flying to the pose you are at does nothing", () => {
    const f = planFlight(CAM.approach, { ...CAM.approach });
    expect(f.length).toBeLessThan(1e-6);
    f.at(0.5).eye.forEach((v, k) => expect(v).toBeCloseTo(CAM.approach.eye[k], 6));
  });
  it("from Top view (on the axis) the route heads straight for the destination's side", () => {
    const s = samples(CAM.top, CAM.approach, 100), b0 = Math.atan2(CAM.approach.eye[1], CAM.approach.eye[0]);
    for (const p of s.slice(10, 90)) {
      if (Math.hypot(p.eye[0], p.eye[1]) < 30) continue;
      let d = Math.atan2(p.eye[1], p.eye[0]) - b0; d = Math.atan2(Math.sin(d), Math.cos(d));
      expect(Math.abs(d)).toBeLessThan(Math.PI / 3);
    }
  });
});
describe("Top view flights (user request 2026-09-27)", () => {
  // screen heading of a view: the horizontal part of its direction (for Top view, the image's up)
  const heading = (p: Pose) => { const d = dirOf(p); return Math.atan2(d[1], d[0]); };
  const dh = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const from of [CAM.aerialSW, CAM.aerialE, CAM.bowl, CAM.approach]) {
    it(`lands on Top view keeping the heading it arrives with, no spin (from ${from.eye.join(",")})`, () => {
      const f = planFlight(from, CAM.top), s = samples(from, CAM.top, 400);
      expect(f.to.eye).toEqual(CAM.top.eye);
      expect(angle(dirOf(f.to), [0, 0, -1])).toBeLessThan(1e-3);        // still straight down
      // over the last fifth of the way the heading barely turns (it used to swing to the Blender camera's)
      for (const p of s.slice(320)) expect(dh(heading(p), heading(f.to))).toBeLessThan((10 * Math.PI) / 180);
    });
  }
  it("flies straight in: no leg out and across at full height (the eye rises as it closes on the axis)", () => {
    const s = samples(CAM.aerialSW, CAM.top, 200);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].eye[2]).toBeGreaterThanOrEqual(s[i - 1].eye[2] - 1e-6);
      expect(Math.hypot(s[i].eye[0], s[i].eye[1])).toBeLessThanOrEqual(Math.hypot(s[i - 1].eye[0], s[i - 1].eye[1]) + 0.05);
    }
  });
  it("leaving Top view the heading turns evenly (no flip through straight down)", () => {
    const s = samples(CAM.top, CAM.seat101, 400);
    for (let i = 1; i < s.length; i++) expect(dh(heading(s[i]), heading(s[i - 1])), `@${i}`).toBeLessThan((6 * Math.PI) / 180);
  });
});
describe("final review fixes (rig)", () => {
  const stub = () => ({ style: {}, clientWidth: 800, clientHeight: 600, ownerDocument: { addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, getRootNode() { return this; }, setPointerCapture() {}, releasePointerCapture() {} }) as unknown as HTMLElement;
  it("zoom pressed mid-flight re-plans the full route (no straight cut through the roof, review 1)", () => {
    const rig = new CameraRig(stub()), to = seatPoses[doc.sections.findIndex((s) => s.id === "312")];
    rig.jump(CAM.aerialSW);
    rig.setMode("look");
    rig.flyTo(to);
    for (let i = 0; i < 20; i++) rig.update(1 / 60);
    rig.zoom(0.7);
    let hit = 0;
    for (let i = 0; i < 400 && rig.flying; i++) { rig.update(1 / 60); if (blocked(rig.pose().eye)) hit++; }
    expect(hit).toBe(0);
  });
  it("landing on a Blender camera below the orbit floor keeps its height (no snap, review 3)", () => {
    const rig = new CameraRig(stub());
    rig.jump(CAM.approach);
    for (let i = 0; i < 5; i++) rig.update(1 / 60);
    expect(rig.pose().eye[2]).toBeCloseTo(CAM.approach.eye[2], 3);
  });
});
