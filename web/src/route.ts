import type { V3 } from "./coords";
import { easeInOutCubic, type Pose } from "./flyto";

/**
 * Camera flight routes (spec v3 C1-C4). Blender coordinates (Z up, metres).
 *
 * The shell is described in plan by two superellipses (scripts/stadium/params.py): the oculus
 * (OCULUS_A/B/N) and the shell's outline (SHELL_A/B/N). `s` is the normalised plan position between
 * them (0 at the oculus rim, 1 at the outline). The envelope below was measured from the raw glb
 * (sails__M_SailSkin, structure__M_Steel; v4 sails: 16 puffier lobes): the skin sits at z 54-59 up to s 0.8
 * and drops to the podium (z 9) by s 1, with lobes bulging to 1.07 x the outline; the roof trusses hang down
 * to ~48 m (s < 0.5), ~41 m at s 0.7, ~34 m at s 0.8.
 */
const OC = { a: 76, b: 63, n: 2.35 }, SH = { a: 138, b: 121, n: 2.25 };
const sup = (x: number, y: number, e: { a: number; b: number; n: number }) =>
  (Math.abs(x / e.a) ** e.n + Math.abs(y / e.b) ** e.n) ** (1 / e.n);
/** Plan position: shell radius (1 on the outline), oculus radius (1 on the rim), s between them. */
export function plan([x, y]: V3) {
  const S = sup(x, y, SH), O = sup(x, y, OC), edge = O > 0 ? S / O : 0;   // shell radius of the rim on this bearing
  return { S, O, s: O <= 1 ? 0 : (S - edge) / (1 - edge) };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (s: number, pts: [number, number][]) => {
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (s <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (s - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
  return pts.at(-1)![1];
};
/** Lowest point of the roof structure (trusses) above plan position s. */
export const roofUnder = (s: number) => ramp(s, [[0.5, 46], [0.8, 32], [1, 8]]);
/** Top of the sail skin above plan position s. */
export const roofTop = (s: number) => ramp(s, [[0.8, 59], [1, 9]]);

/** Inside the bowl's air volume (under the roof, or in the oculus column below the rim). */
export function isInside(p: V3) {
  const { S, O, s } = plan(p);
  // near the rim (O >= 0.97) the trusses start at roofUnder: same bands as blocked(), so no point is both
  return O < 0.97 ? p[2] < 56 : S < 1 && p[2] < roofUnder(s);
}
/**
 * A camera position that is inside geometry: the roof and sails, the shell's base, or the ground. `margin`
 * widens the roof band downward (a resting orbit eye keeps clear of the trusses, so flights from it can too).
 */
/** Outermost plan radius of the sail lobes (S), measured 1.071 on the v4 glb. */
export const SHELL_BULGE = 1.08;
export function blocked(p: V3, margin = 0) {
  const { S, O, s } = plan(p), z = p[2];
  if (z < 1) return true;
  if (O < 0.97 || S > SHELL_BULGE) return false;
  const top = roofTop(s) + 3;
  return (z > roofUnder(s) - margin && z < top) || (s > 0.88 && z < top);
}

export const FLIGHT_MIN_S = 1.5, FLIGHT_MAX_S = 3.6;
/** Flight time from path length: long flights are slower on screen but never drag. */
export const flightSeconds = (len: number) => Math.min(FLIGHT_MAX_S, Math.max(FLIGHT_MIN_S, 1.5 + len / 330));

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (len3(a) || 1));
const dirOf = (p: Pose) => unit(sub(p.target, p.eye));

/**
 * User request (2026-09-25): move with the pitch centred. Routes circle the stadium's axis on the side of
 * the camera and never pass over the pitch centre, so looking at FOCUS all the way needs no turn through
 * the vertical (the v3 draft dived through a hub above the centre point and twisted there).
 */
export const FOCUS: V3 = [0, 0, 0];
const bearing = (p: V3) => Math.atan2(p[1], p[0]);
/** Bearing of p, or of `other` when p is on the axis (Top view): the route then heads for other's side. */
const bearingOr = (p: V3, other: V3) => (onAxis(p) ? bearing(other) : bearing(p));
const onAxis = (p: V3) => Math.hypot(p[0], p[1]) < 5;
/** An outside eye over the shell's plan (above the oculus or the skin) first climbs clear of the roof. */
function climb(p: V3): V3[] {
  const { S } = plan(p);
  return S < 1.1 && p[2] < CLEAR_Z ? [[p[0], p[1], CLEAR_Z]] : [];
}
const radius = (p: V3) => Math.hypot(p[0], p[1]);
const at = (b: number, r: number, z: number): V3 => [Math.cos(b) * r, Math.sin(b) * r, z];
/** Plan radius of the oculus rim on bearing b. */
const rimR = (b: number) => 1 / sup(Math.cos(b), Math.sin(b), OC);
/** Signed shortest angle from a to b. */
const turn = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** Where a flight enters or leaves an inside pose: 6 m above it and 8 m toward the pitch (C3), under the roof. */
function approach(eye: V3): V3 {
  // an eye high in the bowl (> 40 m, near the trusses) is pulled further toward the axis and does not rise
  const r = radius(eye), pull = eye[2] > 40 ? 20 : 8, k = r > pull + 2 ? Math.max(0, (r - pull) / r) : 1;
  const q: V3 = [eye[0] * k, eye[1] * k, Math.min(eye[2] + 6, Math.max(eye[2], 40))];
  const { O, s } = plan(q);
  if (O >= 0.95) q[2] = Math.min(q[2], roofUnder(s) - 3);
  return q;
}

const OUT_R = 200, HIGH_Z = 110, ENTRY_Z = 78, INNER_Z = 40, CLEAR_Z = 80;
/**
 * The way into (or out of) the bowl above an inside pose `eye`: high outside the shell on its bearing, into the
 * oculus on the same side (never above the centre), down below the rim, then its approach point.
 */
function gate(eye: V3): V3[] {
  const b = bearing(eye), q = approach(eye), rr = rimR(b);
  return [at(b, OUT_R * 0.8, HIGH_Z), at(b, rr * 0.6, ENTRY_Z), at(b, rr * 0.8, Math.min(INNER_Z, q[2] + 3)), q];
}
/** Points on an arc around the axis from bearing b0 to b1 (at most 40 degrees apart), radius and height eased. */
function arc(b0: number, b1: number, r0: number, r1: number, z0: number, z1: number, lift = 0): V3[] {
  const d = turn(b0, b1), n = Math.max(1, Math.ceil(Math.abs(d) / ((40 * Math.PI) / 180))), out: V3[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, w = Math.sin(Math.PI * t);
    out.push(at(b0 + d * t, lerp(r0, r1, t), lerp(z0, z1, t) + lift * w));
  }
  return out;
}

interface Route { pts: V3[] }

function outToIn(from: Pose, to: Pose): Route {
  const g = gate(to.eye), hi = g[0];
  const rf = radius(from.eye), r0 = Math.max(rf, OUT_R), z0 = Math.max(from.eye[2], 90), bf = bearingOr(from.eye, hi);
  const pts: V3[] = [from.eye, ...climb(from.eye)];
  // clear of the shell first; from Top view (on the axis, high) head straight out and down instead of
  // sliding sideways at full height first (user request 2026-09-27)
  if ((rf < OUT_R || from.eye[2] < 90) && !(onAxis(from.eye) && from.eye[2] >= 90)) pts.push(at(bf, r0, z0));
  pts.push(...arc(bf, bearing(hi), r0, radius(hi), z0, hi[2]), ...g, to.eye);
  return { pts };
}
function inToOut(from: Pose, to: Pose): Route {
  return { pts: [...outToIn(to, from).pts].reverse() };
}
function inToIn(from: Pose, to: Pose): Route {
  const qa = approach(from.eye), qb = approach(to.eye);
  // around the bowl at the approach points' radius and height, lifted a little, under the roof
  const mid = arc(bearing(qa), bearing(qb), radius(qa), radius(qb), qa[2], qb[2], 4).map((p): V3 => {
    const { O, s } = plan(p);
    return O >= 0.9 ? [p[0], p[1], Math.min(p[2], 40, roofUnder(s) - 3)] : p;
  });
  return { pts: [from.eye, qa, ...mid, qb, to.eye] };
}
function outToOut(from: Pose, to: Pose): Route {
  const rf = Math.max(radius(from.eye), OUT_R), rt = Math.max(radius(to.eye), OUT_R);
  const zf = Math.max(from.eye[2], 60), zt = Math.max(to.eye[2], 60);
  const bf = bearingOr(from.eye, to.eye), bt = bearingOr(to.eye, from.eye);
  const pts: V3[] = [from.eye, ...climb(from.eye)];
  // an eye on the axis high above the roof (Top view) needs no leg out to OUT_R: it flies straight in or out
  const high = (p: V3) => onAxis(p) && p[2] >= 60;
  if ((radius(from.eye) < OUT_R || from.eye[2] < 60) && !high(from.eye)) pts.push(at(bf, rf, zf));
  pts.push(...arc(bf, bt, rf, rt, zf, zt, 30));
  if ((radius(to.eye) < OUT_R || to.eye[2] < 60) && !high(to.eye)) pts.push(at(bt, rt, zt));
  pts.push(...climb(to.eye).reverse(), to.eye);
  return { pts };
}

/** Centripetal Catmull-Rom through the waypoints; u in [0, 1] spans waypoint 0 .. last. */
function curve(pts: V3[]) {
  const n = pts.length - 1;
  const ext = [sub(scale(pts[0], 2), pts[1] ?? pts[0]), ...pts, sub(scale(pts[n], 2), pts[n - 1] ?? pts[n])];
  return (u: number): V3 => {
    const x = Math.min(n - 1e-9, Math.max(0, u * n)), seg = Math.floor(x), t = x - seg;
    const [p0, p1, p2, p3] = [ext[seg], ext[seg + 1], ext[seg + 2], ext[seg + 3]];
    const tj = (a: V3, b: V3) => Math.sqrt(len3(sub(b, a))) || 1e-4;
    const t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3), T = t1 + t * (t2 - t1);
    const L = (a: V3, b: V3, ta: number, tb: number): V3 => add(scale(a, (tb - T) / (tb - ta)), scale(b, (T - ta) / (tb - ta)));
    const a1 = L(p0, p1, 0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3);
    const b1 = L(a1, a2, 0, t2), b2 = L(a2, a3, t1, t3);
    return L(b1, b2, t1, t2);
  };
}
function sampleRoute(r: Route, n: number) {
  const c = curve(r.pts);
  return Array.from({ length: n + 1 }, (_, i) => c(i / n));
}

/**
 * View direction between unit vectors a and b, turning the heading (yaw, the shorter way round) and the pitch
 * separately. A slerp between two steep views with different headings passes through straight down, where
 * the heading, which lookAt derives from the tiny horizontal part, spins at once (leaving Top view);
 * here it turns evenly. Antiparallel level views turn about the vertical, a head turn (final review).
 */
function turnView(a: V3, b: V3, t: number): V3 {
  const ya = Math.atan2(a[1], a[0]), yb = Math.atan2(b[1], b[0]);
  const pa = Math.asin(Math.min(1, Math.max(-1, a[2]))), pb = Math.asin(Math.min(1, Math.max(-1, b[2])));
  const y = ya + turn(ya, yb) * t, p = lerp(pa, pb, t);
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
}
/** Quintic ease: zero velocity and acceleration at both ends, so ramps start and stop without a jolt. */
const smoother = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

/**
 * Time -> distance fraction with fixed-length ramps (C4): speed rises over ACCEL_S, cruises, and falls
 * over BRAKE_S, whatever the duration. A cubic ease over a 3 s flight sat nearly still for the first second.
 */
export const ACCEL_S = 0.7, BRAKE_S = 0.95;
function motionProfile(seconds: number) {
  const ta = Math.min(ACCEL_S / seconds, 0.4), td = Math.min(BRAKE_S / seconds, 0.45), N = 256;
  const v = (x: number) => smoother(Math.min(1, x / ta)) * smoother(Math.min(1, (1 - x) / td));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + (v((i - 0.5) / N)) / N);
  const total = cum[N];
  return (t: number) => { const x = t * N, i = Math.min(N - 1, Math.floor(x)); return (cum[i] + (cum[i + 1] - cum[i]) * (x - i)) / total; };
}

/** `to`: the pose the flight lands on (Top view is turned to the heading it is approached from). */
export interface Flight { seconds: number; length: number; to: Pose; at(t: number): Pose }

/**
 * Top view looks straight down, so its heading is arbitrary: arriving, keep the heading the camera comes in
 * with (looking toward the axis from `from`), instead of spinning to the Blender camera's at the end
 * (user request 2026-09-27). Only for a straight-down pose on the axis, and a start off the axis.
 */
export function reheadTop(from: Pose, to: Pose): Pose {
  const d = sub(to.target, to.eye), n = len3(d);
  if (!onAxis(to.eye) || n === 0 || d[2] / n > -0.99 || onAxis(from.eye)) return to;
  const h = unit([-from.eye[0], -from.eye[1], 0]), c = Math.max(Math.hypot(d[0], d[1]) / n, 1e-4), sz = -Math.sqrt(1 - c * c);
  return { ...to, target: add(to.eye, scale([h[0] * c, h[1] * c, sz], n)) };
}

/**
 * Plans a flight (C1-C4). The eye follows a smooth route that never passes through the shell; the view
 * direction is turned (heading and pitch) between look keys (not a lerped target), the look-at distance log-lerped, and time
 * is eased by arc length so the speed is continuous. `direct` is a straight move (zoom buttons).
 */
export function planFlight(from: Pose, dest: Pose, opts: { direct?: boolean; seconds?: number } = {}): Flight {
  const still = len3(sub(dest.eye, from.eye)) < 0.5;    // same place (a re-clicked view): just turn
  const to = opts.direct || still ? dest : reheadTop(from, dest);
  const fi = isInside(from.eye), ti = isInside(to.eye);
  const r: Route = opts.direct || still ? { pts: [from.eye, to.eye] }
    : fi && ti ? inToIn(from, to) : !fi && ti ? outToIn(from, to) : fi && !ti ? inToOut(from, to) : outToOut(from, to);
  const c = curve(r.pts), N = 512;
  const us: number[] = [0], acc: number[] = [0];
  let prev = c(0);
  for (let i = 1; i <= N; i++) { const p = c(i / N); acc.push(acc[i - 1] + len3(sub(p, prev))); us.push(i / N); prev = p; }
  const length = acc[N];
  const uAt = (e: number) => {                           // arc-length fraction -> curve parameter
    const target = e * length;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] < target) lo = m; else hi = m; }
    const span = acc[hi] - acc[lo];
    return us[lo] + (span > 0 ? (target - acc[lo]) / span : 0) * (us[hi] - us[lo]);
  };
  const dist0 = len3(sub(from.target, from.eye)), dist1 = len3(sub(to.target, to.eye));
  // the view: from the start view into "looking at the pitch centre" over the first 22 % of the way, held
  // there, and into the destination view over the last 22 % (direct flights turn start to end)
  const d0 = dirOf(from), d1 = dirOf(to);
  const look = (e: number, eye: V3): V3 => {
    if (opts.direct || still) return turnView(d0, d1, smoother(e));
    const focus = unit(sub(FOCUS, eye));
    const v = turnView(d0, focus, smoother(Math.min(1, e / 0.22)));
    return turnView(v, d1, smoother(Math.max(0, (e - 0.78) / 0.22)));
  };
  const seconds = opts.seconds ?? flightSeconds(length), ease = opts.direct || still ? easeInOutCubic : motionProfile(seconds);
  return {
    seconds,
    length,
    to,
    at(t: number): Pose {
      if (t <= 0) return from;
      if (t >= 1) return to;
      const e = ease(t), u = uAt(e), eye = c(u), dir = look(e, eye);
      const dist = Math.exp(lerp(Math.log(dist0), Math.log(dist1), smoother(e)));
      return { eye, target: add(eye, scale(dir, dist)), hfov: lerp(from.hfov, to.hfov, smoother(e)) };
    },
  };
}
