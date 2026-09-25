import { describe, expect, it } from "vitest";
import { CameraRig, LOOK_HFOV, MAX_POLAR, MIN_DISTANCE_M, MAX_DISTANCE_M, TARGET_DISC_M, clampOrbit, pivotOf, exposureAt, polarLimit, zoomedPose } from "./camera";
import { planFlight } from "./route";
import type { Pose } from "./flyto";

const A: Pose = { eye: [0, -20, 35], target: [0, 0, 0], hfov: 50 };
const B: Pose = { eye: [10, -50, 8], target: [2, -11, 0], hfov: 55 };
const C: Pose = { eye: [-40, 20, 30], target: [0, 0, 0], hfov: 50 };

it("re-targeting mid-flight starts from the current in-between pose (Review Focus 2)", () => {
  const mid = planFlight(A, B).at(0.4);
  expect(planFlight(mid, C).at(0)).toEqual(mid);
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
    const plan = planFlight(A, B);
    rig.update(plan.seconds / 2);
    const expected = plan.at(0.5);
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

const FLIGHT_S_TEST = 4; // > FLIGHT_MAX_S (3.2 s), forces t to clamp to 1 in a single update()

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
    rig.update(planFlight(A, B).seconds / 2);
    expect(rig.exposure).toBeCloseTo(exposureAt(-0.4, 0.1, 0.5), 10);
    rig.update(FLIGHT_S_TEST);
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

describe("zoom (Review Focus 2)", () => {
  const p = { eye: [0, -100, 50] as [number, number, number], target: [0, 0, 0] as [number, number, number], hfov: 60 };
  it("orbit mode dollies along the view line, clamped to MIN_DISTANCE_M", () => {
    const z = zoomedPose(p, 0.5, "orbit");
    expect(z.target).toEqual(p.target);
    expect(Math.hypot(...z.eye)).toBeCloseTo(Math.hypot(...p.eye) * 0.5, 6);
    expect(Math.hypot(...zoomedPose(p, 1e-6, "orbit").eye)).toBeCloseTo(MIN_DISTANCE_M, 6);
  });
  it("look mode (seat view) narrows the fov and never moves the eye", () => {
    const z = zoomedPose(p, 0.5, "look");
    expect(z.eye).toEqual(p.eye);
    expect(z.hfov).toBe(30);
    expect(zoomedPose(p, 0.01, "look").hfov).toBe(LOOK_HFOV[0]);
    expect(zoomedPose(p, 10, "look").hfov).toBe(LOOK_HFOV[1]);
  });
});

describe("seat view look mode", () => {
  it("no pan or dolly, target may sit right in front of the eye, drag moves the scene with the pointer", () => {
    const rig = new CameraRig(stubDom());
    rig.setAutoOrbit(true);
    rig.setMode("look");
    const c = rig.controls;
    expect([c.enablePan, c.enableZoom, c.minDistance, c.autoRotate]).toEqual([false, false, 0, false]);
    expect(c.rotateSpeed).toBeLessThan(0);          // Street View convention: dragging left turns the view right
    rig.setMode("orbit");
    expect([c.enablePan, c.enableZoom, c.minDistance, c.rotateSpeed]).toEqual([true, true, MIN_DISTANCE_M, 1]);
  });
});

describe("final review fixes", () => {
  const seat: Pose = { eye: [0, -60, 9.2], target: [0, -59.9, 9.18], hfov: 70 };   // look target 0.1 m ahead
  const far: Pose = { eye: [-330, -470, 230], target: [-276, -392, 195], hfov: 46 };
  const run = (rig: CameraRig, s: number) => { for (let i = 0; i < s * 60; i++) rig.update(1 / 60); };
  it("leaving seat view starts the flight from the seat, not 5 m behind it (min distance clamp)", () => {
    const rig = new CameraRig(stubDom());
    rig.setMode("look");
    rig.jump(seat);
    rig.setMode("orbit");
    rig.flyTo(far);
    rig.update(1e-6);
    expect(Math.hypot(...rig.pose().eye.map((v, k) => v - seat.eye[k]))).toBeLessThan(0.01);
  });
  it("zoom pressed during a flight lands on the flight's destination (Review Focus 2)", () => {
    const rig = new CameraRig(stubDom());
    rig.jump(far);
    rig.setMode("look");
    rig.flyTo(seat);
    run(rig, 0.5);
    rig.zoom(0.5);
    run(rig, 4);
    const p = rig.pose();
    expect(Math.hypot(...p.eye.map((v, k) => v - seat.eye[k]))).toBeLessThan(0.01);
    expect(p.hfov).toBeCloseTo(35, 6);
  });
  it("seat view can look up past the horizon", () => {
    const rig = new CameraRig(stubDom());
    rig.setMode("look");
    rig.jump(seat);
    expect(rig.controls.maxPolarAngle).toBeGreaterThanOrEqual((160 * Math.PI) / 180);
    rig.setMode("orbit");
    rig.jump(far);
    expect(rig.controls.maxPolarAngle).toBeCloseTo(MAX_POLAR, 6);
  });
});

describe("orbit limits (spec v3 C5)", () => {
  it("zoom-out stops at MAX_DISTANCE_M (900 m)", () => {
    expect(MAX_DISTANCE_M).toBe(900);
    const p = { eye: [0, -800, 400] as [number, number, number], target: [0, 0, 0] as [number, number, number], hfov: 50 };
    expect(Math.hypot(...zoomedPose(p, 10, "orbit").eye)).toBeCloseTo(MAX_DISTANCE_M, 6);
  });
  it("the orbit target stays on a disc around the stadium and the eye moves with it", () => {
    const r = clampOrbit([900, 0, 300], [700, 0, 100]);
    expect(Math.hypot(r.target[0], r.target[1])).toBeCloseTo(TARGET_DISC_M, 6);
    expect(r.target[2]).toBe(60);
    expect(r.eye.map((v, k) => v - r.target[k])).toEqual([200, 0, 200]);
  });
  it("the eye stays above the ground (3 m outside the shell, 2 m inside)", () => {
    expect(clampOrbit([400, 0, -5], [100, 0, 0]).eye[2]).toBe(3);
    expect(clampOrbit([0, -30, 0.5], [0, 0, 0]).eye[2]).toBe(2);
    const p = pivotOf({ eye: [-330, -470, 230], target: [-276.7634, -392.5649, 195.7995], hfov: 46 });
    expect(clampOrbit(p.eye, p.target)).toEqual({ eye: p.eye, target: p.target });   // the overview is inside the limits
  });
});

describe("orbit pivot of a Blender camera pose", () => {
  const dir = (p: { eye: number[]; target: number[] }) => { const d = p.target.map((v, k) => v - p.eye[k]), n = Math.hypot(...d); return d.map((v) => v / n); };
  it("keeps the view and moves the target to where the view meets the ground near the stadium", () => {
    const cam = { eye: [-330, -470, 230] as [number, number, number], target: [-276.7634, -392.5649, 195.7995] as [number, number, number], hfov: 46 };
    const p = pivotOf(cam);
    expect(p.eye).toEqual(cam.eye);
    dir(p).forEach((v, k) => expect(v).toBeCloseTo(dir(cam)[k], 9));
    expect(p.target[2]).toBeCloseTo(0, 6);
    expect(Math.hypot(p.target[0], p.target[1])).toBeLessThan(TARGET_DISC_M);
  });
  it("a camera looking up (CAM_Pitch) pivots on its view ray near the stadium axis", () => {
    const cam = { eye: [0, -30, 1.7] as [number, number, number], target: [0, 67.5494, 23.7028] as [number, number, number], hfov: 90 };
    const p = pivotOf(cam);
    dir(p).forEach((v, k) => expect(v).toBeCloseTo(dir(cam)[k], 9));
    expect(Math.hypot(...p.target.map((v, k) => v - cam.eye[k]))).toBeGreaterThanOrEqual(MIN_DISTANCE_M);
  });
});
