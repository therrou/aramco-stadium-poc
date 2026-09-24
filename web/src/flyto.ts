import type { V3 } from "./coords";
import type { CameraDef, Section } from "./loader";

export interface Pose { eye: V3; target: V3; hfov: number }

/** Decision D3: zoom to the area. From over the pitch, 60 m in front of the section and 25 m above it. */
export function sectionFraming(s: Section): Pose {
  const [cx, cy, cz] = s.centroid, r = Math.hypot(cx, cy);
  const k = Math.max(0, (r - 60) / r);
  return { eye: [cx * k, cy * k, cz + 25], target: [cx, cy, cz], hfov: 55 };
}

export const cameraPose = (c: CameraDef): Pose => ({ eye: c.eye, target: c.target, hfov: c.hfov });

/** Blender sensor_fit AUTO: the fov applies to the larger image side. Returns Three's vertical fov. */
export function verticalFov(hfovLarger: number, aspect: number) {
  if (aspect <= 1) return hfovLarger;
  const h = (hfovLarger * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const inside = ([x, y, z]: V3) => Math.hypot(x / 76, y / 63) < 1 && z < 60;   // params.OCULUS_A/B, rim ~56 m

/** Crossing the shell goes through a control point high over the oculus; otherwise a straight line. */
export function pathPoint(from: V3, to: V3, t: number): V3 {
  if (inside(from) === inside(to)) return [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t) as V3;
  const c: V3 = [0, 0, Math.max(from[2], to[2], 180)];
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * from[k] + 2 * u * t * c[k] + t * t * to[k]) as V3;
}
