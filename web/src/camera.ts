import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toBlender, toThree, type V3 } from "./coords";
import { easeInOutCubic, pathPoint, verticalFov, type Pose } from "./flyto";

export const FLIGHT_S = 1.5;
/** Near plane (Task 13b): 0.1 -> 0.5 m. The closest views (section seats) keep geometry >= ~1 m away. */
export const NEAR_M = 0.5;
const lerp3 = (a: V3, b: V3, t: number) => a.map((v, k) => v + (b[k] - v) * t) as V3;

export function poseAt(from: Pose, to: Pose, t: number): Pose {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const e = easeInOutCubic(t);
  return { eye: pathPoint(from.eye, to.eye, e), target: lerp3(from.target, to.target, e), hfov: from.hfov + (to.hfov - from.hfov) * e };
}

/**
 * Final review 2: camera exposure (stops) follows the flight with the same eased progress as the pose,
 * so a section click or Back does not jump the brightness.
 */
export function exposureAt(from: number, to: number, t: number) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return from + (to - from) * easeInOutCubic(t);
}

/**
 * Final review 11: orbit no lower than 5 deg above the horizon, and no closer than 5 m to the target.
 * Some Blender cameras look up (CAM_Pitch 103 deg, CAM_Approach 96, CAM_Sign 88 from the zenith): landing
 * on one relaxes the limit to that pose, else OrbitControls would snap it the first frame after landing.
 */
export const MAX_POLAR = (85 * Math.PI) / 180;
export const MIN_DISTANCE_M = 5;
export function polarLimit(p: Pose) {
  const d = p.eye.map((v, k) => v - p.target[k]), r = Math.hypot(...d);
  return r > 0 ? Math.max(MAX_POLAR, Math.acos(Math.min(1, Math.max(-1, d[2] / r))) + 1e-3) : MAX_POLAR;
}

export class CameraRig {
  camera = new THREE.PerspectiveCamera(40, 1, NEAR_M, 8000);
  controls: OrbitControls;
  private hfov = 40;
  /** Camera exposure in stops (Blender camera["exposure"]); interpolated during a flight. */
  exposure = 0;
  private flight: { from: Pose; to: Pose; expFrom: number; expTo: number; t: number; done: () => void } | null = null;
  constructor(dom: HTMLElement) {
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 2500;
    this.controls.minDistance = MIN_DISTANCE_M;
    this.controls.maxPolarAngle = MAX_POLAR;
  }
  get flying() { return this.flight !== null; }
  pose(): Pose { return { eye: toBlender(this.camera.position), target: toBlender(this.controls.target), hfov: this.hfov }; }
  private apply(p: Pose) {
    this.camera.position.copy(toThree(p.eye));
    this.controls.target.copy(toThree(p.target));
    this.hfov = p.hfov;
    this.camera.fov = verticalFov(p.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.controls.maxPolarAngle = polarLimit(p);
  }
  /**
   * Starts from the current pose, so a click mid-flight re-targets smoothly (Review Focus 2).
   * Flushes any residual OrbitControls damping momentum (from a drag or inertial pan just
   * before the click) into position/target first, and zeroes it, so it can't leak into the
   * flight over the following frames: three's OrbitControls.update() decays its internal
   * sphericalDelta/panOffset by `dampingFactor` each call rather than clearing them outright,
   * so a temporary `dampingFactor = 1` consumes the whole remaining delta in one step.
   */
  flyTo(to: Pose, exposure = this.exposure) {
    this.flight?.done();
    const damping = this.controls.dampingFactor;
    this.controls.dampingFactor = 1;
    this.controls.update();
    this.controls.dampingFactor = damping;
    return new Promise<void>((done) => { this.flight = { from: this.pose(), to, expFrom: this.exposure, expTo: exposure, t: 0, done }; this.controls.enabled = false; });
  }
  jump(p: Pose, exposure = this.exposure) { this.apply(p); this.exposure = exposure; }
  update(dt: number) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLIGHT_S);
      this.apply(poseAt(f.from, f.to, f.t));
      this.exposure = exposureAt(f.expFrom, f.expTo, f.t);
      if (f.t >= 1) { this.flight = null; this.controls.enabled = true; f.done(); }
      return;                        // don't let controls.update() re-derive position from stale internal state mid-flight
    }
    this.controls.update();
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}
