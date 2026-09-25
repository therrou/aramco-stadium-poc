import { describe, expect, it } from "vitest";
import { CameraRig, MAX_POLAR, MIN_DISTANCE_M, exposureAt, polarLimit, poseAt } from "./camera";
import type { Pose } from "./flyto";

const A: Pose = { eye: [0, -20, 35], target: [0, 0, 0], hfov: 50 };
const B: Pose = { eye: [10, -50, 8], target: [2, -11, 0], hfov: 55 };
const C: Pose = { eye: [-40, 20, 30], target: [0, 0, 0], hfov: 50 };

it("poseAt hits both ends and eases", () => {
  expect(poseAt(A, B, 0)).toEqual(A);
  expect(poseAt(A, B, 1)).toEqual(B);
  expect(poseAt(A, B, 0.1).eye[0]).toBeLessThan(1);          // slow start
});

it("re-targeting mid-flight starts from the current in-between pose (Review Focus 2)", () => {
  const mid = poseAt(A, B, 0.4);
  expect(poseAt(mid, C, 0)).toEqual(mid);
  expect(poseAt(mid, C, 0.01).eye[0]).toBeCloseTo(mid.eye[0], 0);
});

/**
 * Minimal DOM-element stub so OrbitControls can be constructed in Node (vitest's default
 * environment has no DOM). Only exercises the handful of members OrbitControls touches at
 * construction / update time; no real events are ever dispatched through it.
 */
function stubDom(): HTMLElement {
  const doc = { addEventListener() {}, removeEventListener() {} };
  const el = {
    style: {},
    clientWidth: 800,
    clientHeight: 600,
    ownerDocument: doc,
    getRootNode: () => doc,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  return el as unknown as HTMLElement;
}

describe("CameraRig vs. OrbitControls damping momentum (fix round 1)", () => {
  it("flyTo flushes stale damping momentum before capturing the from pose", () => {
    const rig = new CameraRig(stubDom());
    rig.jump(A);
    // simulate leftover inertial rotation from a drag/pan that ended just before the click
    (rig.controls as any)._sphericalDelta.theta = 0.3;
    (rig.controls as any)._sphericalDelta.phi = 0.05;
    (rig.controls as any)._panOffset.set(1, 2, 3);
    rig.flyTo(B);
    expect((rig.controls as any)._sphericalDelta.theta).toBeCloseTo(0, 10);
    expect((rig.controls as any)._sphericalDelta.phi).toBeCloseTo(0, 10);
    expect((rig.controls as any)._panOffset.length()).toBeCloseTo(0, 10);
  });

  it("does not let controls.update() perturb the eased path mid-flight", () => {
    const rig = new CameraRig(stubDom());
    rig.jump(A);
    rig.flyTo(B);
    // inject a bogus damping delta mid-flight, as if a stray pointer/inertia event fired;
    // if update() called controls.update() while flying this would bend the path
    (rig.controls as any)._sphericalDelta.theta = 1;
    rig.update(0.75); // FLIGHT_S = 1.5s, so this lands at t = 0.5
    const expected = poseAt(A, B, 0.5);
    const p = rig.pose();
    expect(p.eye[0]).toBeCloseTo(expected.eye[0], 6);
    expect(p.eye[1]).toBeCloseTo(expected.eye[1], 6);
    expect(p.eye[2]).toBeCloseTo(expected.eye[2], 6);
    expect(p.target[0]).toBeCloseTo(expected.target[0], 6);
    expect(p.target[1]).toBeCloseTo(expected.target[1], 6);
    expect(p.target[2]).toBeCloseTo(expected.target[2], 6);
  });

  it("lands exactly on the target pose and re-enables controls when the flight completes", async () => {
    const rig = new CameraRig(stubDom());
    rig.jump(A);
    const done = rig.flyTo(B);
    rig.update(FLIGHT_S_TEST); // advance past the end in one big step, as a slow frame might
    await done;
    expect(rig.flying).toBe(false);
    expect(rig.controls.enabled).toBe(true);
    const p = rig.pose();
    expect(p.eye[0]).toBeCloseTo(B.eye[0], 6);
    expect(p.eye[1]).toBeCloseTo(B.eye[1], 6);
    expect(p.eye[2]).toBeCloseTo(B.eye[2], 6);
  });
});

const FLIGHT_S_TEST = 2; // > FLIGHT_S (1.5s), forces t to clamp to 1 in a single update()

describe("camera exposure follows the flight (final review 2)", () => {
  it("exposureAt eases between the ends like the pose", () => {
    expect(exposureAt(-0.4, 0.1, 0)).toBe(-0.4);
    expect(exposureAt(-0.4, 0.1, 1)).toBe(0.1);
    expect(exposureAt(-0.4, 0.1, 0.5)).toBeCloseTo(-0.15, 10);
    expect(exposureAt(-0.4, 0.1, 0.1)).toBeLessThan(-0.39);          // slow start, no jump
    let prev = -0.4;
    for (let t = 0.02; t <= 1; t += 0.02) { const e = exposureAt(-0.4, 0.1, t); expect(e - prev).toBeLessThan(0.031); prev = e; }
  });
  it("the rig interpolates exposure with the pose and lands on the target value", () => {
    const rig = new CameraRig(stubDom());
    rig.jump(A, -0.4);
    rig.flyTo(B, 0.1);
    rig.update(0.75);
    expect(rig.exposure).toBeCloseTo(exposureAt(-0.4, 0.1, 0.5), 10);
    rig.update(1);
    expect(rig.exposure).toBe(0.1);
    rig.flyTo(A, -0.4);
    rig.update(FLIGHT_S_TEST);
    expect(rig.exposure).toBe(-0.4);
  });
});

describe("orbit limits (final review 11)", () => {
  it("controls stay above the horizon and off the target", () => {
    const rig = new CameraRig(stubDom());
    rig.jump(A);
    expect(rig.controls.maxPolarAngle).toBeCloseTo(MAX_POLAR, 10);
    expect(rig.controls.minDistance).toBe(MIN_DISTANCE_M);
  });
  it("a camera looking up keeps its own angle as the limit (no snap after landing)", () => {
    const up: Pose = { eye: [0, 0, 2], target: [0, 100, 20], hfov: 50 };
    expect(polarLimit(up)).toBeGreaterThan(Math.PI / 2);
    const rig = new CameraRig(stubDom());
    rig.jump(up);
    rig.update(1 / 60);
    expect(rig.pose().eye[2]).toBeCloseTo(2, 6);
  });
});
