import type { V3 } from "./coords";
import { easeInOutCubic, type Pose } from "./flyto";

/**
 * Camera flight routes (spec v3 C1-C4). Blender coordinates (Z up, metres).
 *
 * The shell is described in plan by two superellipses (scripts/stadium/params.py): the oculus
 * (OCULUS_A/B/N) and the shell's outline (SHELL_A/B/N). `s` is the normalised plan position between
 * them (0 at the oculus rim, 1 at the outline). The envelope below was measured from the raw glb
 * (sails__M_SailSkin, structure__M_Steel): the skin sits at z 56-58 up to s 0.8 and drops to the podium
 * (z 9) by s 1; the roof trusses hang down to ~48 m (s < 0.5), ~41 m at s 0.7, ~34 m at s 0.8.
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
export const roofTop = (s: number) => ramp(s, [[0.8, 58], [1, 9]]);

/** Inside the bowl's air volume (under the roof, or in the oculus column below the rim). */
export function isInside(p: V3) {
  const { S, O, s } = plan(p);
  return O < 1 ? p[2] < 56 : S < 1 && p[2] < roofUnder(s);
}
/** A camera position that is inside geometry: the roof and sails, the shell's base, or the ground. */
export function blocked(p: V3) {
  const { S, O, s } = plan(p), z = p[2];
  if (z < 1) return true;
  if (O < 0.97 || S > 1.04) return false;
  const top = roofTop(s) + 3;
  return (z > roofUnder(s) && z < top) || (s > 0.88 && z < top);
}

export const FLIGHT_MIN_S = 1.2, FLIGHT_MAX_S = 3.2;
/** Flight time from path length: long flights are slower on screen but never drag. */
export const flightSeconds = (len: number) => Math.min(FLIGHT_MAX_S, Math.max(FLIGHT_MIN_S, 1.2 + len / 350));

const APEX_Z = 95, HUB: V3 = [0, 0, 34], LOW_Z = 75;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (len3(a) || 1));
const dirOf = (p: Pose) => unit(sub(p.target, p.eye));

/** Where a flight enters or leaves an inside pose: 6 m above it and 8 m toward the pitch (C3), under the roof. */
function approach(eye: V3): V3 {
  const r = Math.hypot(eye[0], eye[1]), k = r > 10 ? Math.max(0, (r - 8) / r) : 1;
  const q: V3 = [eye[0] * k, eye[1] * k, eye[2] + 6];
  const { O, s } = plan(q);
  if (O >= 1) q[2] = Math.min(q[2], roofUnder(s) - 3);
  return q;
}
/** A point above the stadium's axis, looking down at the pitch while passing the oculus. */
const apex = (z: number): V3 => [0, 0, Math.max(APEX_Z, Math.min(z, 160))];
/** An outside point low enough to hit the shell on a straight line gets a waypoint lifted clear of it. */
function lift(p: V3, towardAxis: number): V3 | null {
  if (p[2] >= LOW_Z) return null;
  return [p[0] * towardAxis, p[1] * towardAxis, LOW_Z];
}

interface Key { i: number; dir: V3 }
interface Route { pts: V3[]; keys: Key[] }   // a key's i is a waypoint index

/** The view straight down the axis is degenerate for lookAt; lean 20 degrees toward `side` (plan). */
function downToward(side: V3): V3 {
  const r = Math.hypot(side[0], side[1]) || 1;
  return unit([(side[0] / r) * 0.36, (side[1] / r) * 0.36, -1]);
}
const lookAt = (from: V3, at: V3) => unit(sub(at, from));

function outToIn(from: Pose, to: Pose): Route {
  const pts: V3[] = [from.eye], keys: Key[] = [{ i: 0, dir: dirOf(from) }];
  const l = lift(from.eye, 0.85);
  if (l && !blocked(l)) pts.push(l);
  const q = approach(to.eye);
  pts.push(apex(from.eye[2]));
  keys.push({ i: pts.length - 1, dir: downToward(to.eye) });
  pts.push(HUB, q, to.eye);
  keys.push({ i: pts.length - 2, dir: dirOf(to) }, { i: pts.length - 1, dir: dirOf(to) });
  return { pts, keys };
}
function reverse(r: Route, from: Pose, to: Pose): Route {
  const n = r.pts.length - 1;
  const keys = r.keys.map((k) => ({ i: n - k.i, dir: k.dir })).reverse();
  keys[0] = { i: 0, dir: dirOf(from) };
  keys[keys.length - 1] = { i: n, dir: dirOf(to) };
  return { pts: [...r.pts].reverse(), keys };
}
function inToOut(from: Pose, to: Pose): Route {
  // the reverse of the inbound route; on the way out the look keys are the leaving seat's view, then down
  const r = reverse(outToIn(to, from), from, to);
  r.keys = r.keys.map((k, j) => (j === 1 ? { i: k.i, dir: dirOf(from) } : k));
  return r;
}
function inToIn(from: Pose, to: Pose): Route {
  const qa = approach(from.eye), qb = approach(to.eye), chord = len3(sub(qb, qa));
  const mid: V3 = [(qa[0] + qb[0]) / 4, (qa[1] + qb[1]) / 4, Math.min(Math.max(qa[2], qb[2]) + 0.12 * chord, 44)];
  const pts = [from.eye, qa, mid, qb, to.eye];
  return { pts, keys: [{ i: 0, dir: dirOf(from) }, { i: 1, dir: dirOf(from) }, { i: 2, dir: lookAt(mid, [qb[0], qb[1], qb[2] - 6]) }   /* heading for the destination, not down at the grass */, { i: 3, dir: dirOf(to) }, { i: 4, dir: dirOf(to) }] };
}
function outToOut(from: Pose, to: Pose): Route {
  const chord = len3(sub(to.eye, from.eye));
  const mid = add(scale(add(from.eye, to.eye), 0.5), [0, 0, 0.1 * chord]);
  const straight: Route = { pts: [from.eye, mid, to.eye], keys: [{ i: 0, dir: dirOf(from) }, { i: 2, dir: dirOf(to) }] };
  if (!sampleRoute(straight, 64).some(blocked)) return straight;
  // around the stadium: an arc at plan radius >= 200 m, lifted clear of the roof
  const af = Math.atan2(from.eye[1], from.eye[0]), at = Math.atan2(to.eye[1], to.eye[0]);
  let d = at - af;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  const R = Math.max(200, Math.hypot(from.eye[0], from.eye[1]), Math.hypot(to.eye[0], to.eye[1]));
  const pts: V3[] = [from.eye], keys: Key[] = [{ i: 0, dir: dirOf(from) }];
  for (const t of [0.25, 0.5, 0.75]) {
    const a = af + d * t, z = Math.max(LOW_Z, lerp(from.eye[2], to.eye[2], t) + 0.08 * chord);
    pts.push([Math.cos(a) * R, Math.sin(a) * R, z]);
  }
  keys.push({ i: 2, dir: lookAt(pts[2], [0, 0, 25]) });
  pts.push(to.eye);
  keys.push({ i: pts.length - 1, dir: dirOf(to) });
  return { pts, keys };
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

/** Normalised slerp between unit vectors. */
function slerp(a: V3, b: V3, t: number): V3 {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), w = Math.acos(d);
  if (w < 1e-6) return b;
  const sa = Math.sin((1 - t) * w) / Math.sin(w), sb = Math.sin(t * w) / Math.sin(w);
  return unit([a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb]);
}
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Time -> distance fraction with fixed-length ramps (C4): speed rises over ACCEL_S, cruises, and falls
 * over BRAKE_S, whatever the duration. A cubic ease over a 3 s flight sat nearly still for the first second.
 */
export const ACCEL_S = 0.45, BRAKE_S = 0.6;
function motionProfile(seconds: number) {
  const ta = Math.min(ACCEL_S / seconds, 0.4), td = Math.min(BRAKE_S / seconds, 0.45), N = 256;
  const v = (x: number) => smooth(Math.min(1, x / ta)) * smooth(Math.min(1, (1 - x) / td));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + (v((i - 0.5) / N)) / N);
  const total = cum[N];
  return (t: number) => { const x = t * N, i = Math.min(N - 1, Math.floor(x)); return (cum[i] + (cum[i + 1] - cum[i]) * (x - i)) / total; };
}

export interface Flight { seconds: number; length: number; at(t: number): Pose }

/**
 * Plans a flight (C1-C4). The eye follows a smooth route that never passes through the shell; the view
 * direction is slerped between look keys (not a lerped target), the look-at distance log-lerped, and time
 * is eased by arc length so the speed is continuous. `direct` is a straight move (zoom buttons).
 */
export function planFlight(from: Pose, to: Pose, opts: { direct?: boolean; seconds?: number } = {}): Flight {
  const fi = isInside(from.eye), ti = isInside(to.eye);
  const r: Route = opts.direct ? { pts: [from.eye, to.eye], keys: [{ i: 0, dir: dirOf(from) }, { i: 1, dir: dirOf(to) }] }
    : fi && ti ? inToIn(from, to) : !fi && ti ? outToIn(from, to) : fi && !ti ? inToOut(from, to) : outToOut(from, to);
  const c = curve(r.pts), N = 512, n = r.pts.length - 1;
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
  const look = (u: number): V3 => {
    const x = u * n, ks = r.keys;
    if (x <= ks[0].i) return ks[0].dir;
    for (let j = 1; j < ks.length; j++) if (x <= ks[j].i) return slerp(ks[j - 1].dir, ks[j].dir, smooth((x - ks[j - 1].i) / (ks[j].i - ks[j - 1].i || 1)));
    return ks.at(-1)!.dir;
  };
  const seconds = opts.seconds ?? flightSeconds(length), ease = opts.direct ? easeInOutCubic : motionProfile(seconds);
  return {
    seconds,
    length,
    at(t: number): Pose {
      if (t <= 0) return from;
      if (t >= 1) return to;
      const e = ease(t), u = uAt(e), eye = c(u), dir = look(u);
      const dist = Math.exp(lerp(Math.log(dist0), Math.log(dist1), smooth(e)));
      return { eye, target: add(eye, scale(dir, dist)), hfov: lerp(from.hfov, to.hfov, smooth(e)) };
    },
  };
}
