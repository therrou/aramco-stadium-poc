import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toBlender, toThree, type V3 } from "./coords";
import { easeInOutCubic, verticalFov, type Pose } from "./flyto";
import { blocked, plan, planFlight, roofTop, type Flight } from "./route";

/** Near plane (Task 13b): 0.1 -> 0.5 m. The closest views (section seats) keep geometry >= ~1 m away. */
export const NEAR_M = 0.5;

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
export const MIN_DISTANCE_M = 15;
export function polarLimit(p: Pose) {
  const d = p.eye.map((v, k) => v - p.target[k]), r = Math.hypot(...d);
  return r > 0 ? Math.max(MAX_POLAR, Math.acos(Math.min(1, Math.max(-1, d[2] / r))) + 1e-3) : MAX_POLAR;
}

export type RigMode = "orbit" | "look";
/** Seat view zoom range (hfov, deg). */
export const LOOK_HFOV = [25, 90] as const;
/** Seat view may look up at the roof and sails (orbit keeps MAX_POLAR, 5 deg above the horizon). */
export const LOOK_MAX_POLAR = (165 * Math.PI) / 180;
export const ZOOM_S = 0.35, AUTO_ORBIT_SPEED = 0.6;
/** Spec v3 C5: orbit distance 15-900 m, target on a 320 m disc at z 0-60, eye above the ground. */
export const MAX_DISTANCE_M = 900, TARGET_DISC_M = 320;
/**
 * `floor`: a lower ground clearance for the pose being held (a Blender camera at eye height lands at 1.7 m).
 * Final review: the eye may not rest inside geometry (roof, trusses, sails): it slides toward the target
 * until clear, or rises over the roof.
 */
export function clampOrbit(eye: V3, target: V3, floor = Infinity) {
  const r = Math.hypot(target[0], target[1]), k = r > TARGET_DISC_M ? TARGET_DISC_M / r : 1;
  const t: V3 = [target[0] * k, target[1] * k, Math.min(60, Math.max(0, target[2]))];
  let e: V3 = [eye[0] + t[0] - target[0], eye[1] + t[1] - target[1], eye[2] + t[2] - target[2]];
  e[2] = Math.max(e[2], Math.min(floor, plan(e).S < 1 ? 2 : 3));
  if (blocked(e, 2)) {
    let found = false;
    for (let f = 0.95; f > 0.04 && !found; f -= 0.05) {
      const q: V3 = [t[0] + (e[0] - t[0]) * f, t[1] + (e[1] - t[1]) * f, t[2] + (e[2] - t[2]) * f];
      if (!blocked(q, 2) && Math.hypot(q[0] - t[0], q[1] - t[1], q[2] - t[2]) >= MIN_DISTANCE_M) { e = q; found = true; }
    }
    if (!found) e = [e[0], e[1], roofTop(plan(e).s) + 4];
  }
  return { eye: e, target: t };
}
/** Zoom buttons: orbit dollies toward the target; look (seat view) changes the fov so the eye stays in the seat. */
export function zoomedPose(p: Pose, f: number, mode: RigMode): Pose {
  if (mode === "look") return { ...p, hfov: Math.min(LOOK_HFOV[1], Math.max(LOOK_HFOV[0], p.hfov * f)) };
  const d = p.eye.map((v, k) => v - p.target[k]), r = Math.hypot(...d);
  const k = Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, r * f)) / r;
  return { ...p, eye: p.target.map((v, i) => v + d[i] * k) as V3 };
}

/**
 * Blender camera poses aim at a point 100 m ahead of the lens, which is no orbit pivot (for the overview it
 * lies 480 m from the stadium). Keep the view, and put the target where the view ray meets the ground,
 * or else at the ray's closest approach to the stadium's axis (cameras looking up), at least 15 m ahead.
 */
export function pivotOf(p: Pose): Pose {
  const d = p.target.map((v, k) => v - p.eye[k]), n = Math.hypot(...d), u = d.map((v) => v / n);
  let t: number;
  const hit = u[2] < -0.05 ? -p.eye[2] / u[2] : -1;
  if (hit > 0 && Math.hypot(p.eye[0] + u[0] * hit, p.eye[1] + u[1] * hit) < TARGET_DISC_M) t = hit;
  else t = -(p.eye[0] * u[0] + p.eye[1] * u[1]) / (u[0] * u[0] + u[1] * u[1] || 1);   // nearest the axis in plan
  t = Math.min(MAX_DISTANCE_M * 0.9, Math.max(MIN_DISTANCE_M, t));
  return { ...p, target: p.eye.map((v, k) => v + u[k] * t) as V3 };
}

/**
 * User request 2026-09-28: the aerial views orbit around the stadium's own axis (the oculus centre), not
 * where their view ray meets the ground (CAM_Aerial_SW's lands ~58 m north-east of it, so the stadium sat
 * off-centre and the orbit swung around a point on the pitch's far side). CENTRE_Z puts the whole shell
 * (ground to the 58 m rim) in the middle of the frame. The eye stays; only the aim changes.
 */
export const CENTRE_Z = 25;
export const AERIAL_RE = /^CAM_(Aerial|Top)/;
export const centredPivot = (p: Pose): Pose => ({ ...p, target: [0, 0, CENTRE_Z] });
/** Orbit pose for a named Blender camera: aerials aim at the stadium axis, the rest keep their view. */
export const orbitPoseOf = (name: string, p: Pose): Pose => (AERIAL_RE.test(name) ? centredPivot(p) : pivotOf(p));

export class CameraRig {
  camera = new THREE.PerspectiveCamera(40, 1, NEAR_M, 8000);
  controls: OrbitControls;
  private hfov = 40;
  /** Camera exposure in stops (Blender camera["exposure"]); interpolated during a flight. */
  exposure = 0;
  private flight: { plan: Flight; to: Pose; expFrom: number; expTo: number; t: number; done: () => void } | null = null;
  mode: RigMode = "orbit";
  /** Ground clearance allowed for the pose last jumped or flown to (review 3: no snap after landing). */
  private floorZ = Infinity;
  constructor(dom: HTMLElement) {
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxDistance = MAX_DISTANCE_M;
    this.controls.minDistance = MIN_DISTANCE_M;
    this.controls.maxPolarAngle = MAX_POLAR;
    // user request 2026-09-28: no zoom anywhere (wheel, pinch, buttons); pan stays in the orbit view
    this.controls.enableZoom = false;
  }
  get flying() { return this.flight !== null; }
  /**
   * Look mode (seat view): drag turns the head around a target SEAT_LOOK_M ahead; no pan, no dolly.
   * Negative rotate speed: the scene follows the pointer (Street View), not the orbit's inverse.
   */
  setMode(m: RigMode) {
    this.mode = m;
    const c = this.controls;
    c.enablePan = m === "orbit";
    c.enableZoom = false;                            // user request 2026-09-28: pan yes, zoom no
    c.minDistance = m === "orbit" ? MIN_DISTANCE_M : 0;
    c.rotateSpeed = m === "orbit" ? 1 : -0.35;
    if (m === "look") this.setAutoOrbit(false);
    c.maxPolarAngle = m === "look" ? LOOK_MAX_POLAR : polarLimit(this.pose());
  }
  setAutoOrbit(on: boolean) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = AUTO_ORBIT_SPEED; }
  /** Any drag or wheel on the canvas (OrbitControls "start"). */
  onUserInput(cb: () => void) { this.controls.addEventListener("start", cb); }
  /** Zooms from where the camera is going: pressed mid-flight, it must not strand the camera between poses. */
  zoom(f: number) {
    // mid-flight: re-plan the whole route to the zoomed destination (a straight cut crossed the roof)
    if (this.flight) return this.flyTo(zoomedPose(this.flight.to, f, this.mode), this.flight.expTo);
    return this.flyTo(zoomedPose(this.pose(), f, this.mode), this.exposure, { direct: true, seconds: ZOOM_S });
  }
  pose(): Pose { return { eye: toBlender(this.camera.position), target: toBlender(this.controls.target), hfov: this.hfov }; }
  private apply(p: Pose) {
    this.camera.position.copy(toThree(p.eye));
    this.controls.target.copy(toThree(p.target));
    this.hfov = p.hfov;
    this.camera.fov = verticalFov(p.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.controls.maxPolarAngle = this.mode === "look" ? LOOK_MAX_POLAR : polarLimit(p);
  }
  /**
   * Starts from the current pose, so a click mid-flight re-targets smoothly (Review Focus 2).
   * Flushes any residual OrbitControls damping momentum (from a drag or inertial pan just
   * before the click) into position/target first, and zeroes it, so it can't leak into the
   * flight over the following frames: three's OrbitControls.update() decays its internal
   * sphericalDelta/panOffset by `dampingFactor` each call rather than clearing them outright,
   * so a temporary `dampingFactor = 1` consumes the whole remaining delta in one step.
   */
  flyTo(to: Pose, exposure = this.exposure, opts: { direct?: boolean; seconds?: number } = {}) {
    this.flight?.done();
    // flush without the distance clamp: leaving seat view (target 0.1 m ahead) with orbit's 5 m minimum
    // would otherwise push the eye ~5 m back before the flight starts (final review)
    const c = this.controls, damping = c.dampingFactor, [minD, maxD] = [c.minDistance, c.maxDistance];
    c.dampingFactor = 1;
    c.minDistance = 0;
    c.maxDistance = Infinity;
    c.update();
    [c.dampingFactor, c.minDistance, c.maxDistance] = [damping, minD, maxD];
    // the plan may turn the landing pose (Top view keeps the heading it is approached with)
    return new Promise<void>((done) => { const plan = planFlight(this.pose(), to, opts); this.flight = { plan, to: plan.to, expFrom: this.exposure, expTo: exposure, t: 0, done }; this.controls.enabled = false; });
  }
  jump(p: Pose, exposure = this.exposure) { this.apply(p); this.exposure = exposure; this.floorZ = p.eye[2]; }
  update(dt: number) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.plan.seconds);
      this.apply(f.plan.at(f.t));
      this.exposure = exposureAt(f.expFrom, f.expTo, f.t);
      if (f.t >= 1) { this.floorZ = f.to.eye[2]; this.flight = null; this.controls.enabled = true; f.done(); }
      return;                        // don't let controls.update() re-derive position from stale internal state mid-flight
    }
    this.controls.update();
    if (this.mode === "orbit") {                // C5: keep the orbit over the site and above the ground
      const eye = toBlender(this.camera.position), target = toBlender(this.controls.target), c = clampOrbit(eye, target, this.floorZ);
      if (c.eye.some((v, k) => v !== eye[k]) || c.target.some((v, k) => v !== target[k])) {
        this.camera.position.copy(toThree(c.eye));
        this.controls.target.copy(toThree(c.target));
        this.camera.lookAt(this.controls.target);
      }
    }
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}
