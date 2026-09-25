import type { V3 } from "./coords";
import type { SeatTable } from "./seatsData";

/** Height of a seat's visual centre above its tread origin (seat back top ~0.93 m, pan 0.44 m). */
export const SEAT_CENTRE_M = 0.6;

/** Seats this far from the strip hit point are candidates (rows ~0.8-0.9 m apart, strip 0.5 m above them). */
export const PICK_NEAR_M = 2.5;

/**
 * Seat of one section (index range r) whose centre is closest to the ray o + s d (Blender coords, d unit,
 * s > 0). The section comes from the section-strip raycast, so this runs over <= ~600 seats per pick. With
 * the strip's hit point, only seats near it compete (final review: at grazing angles, e.g. looking along
 * your own row, a seat farther down the ray could win); if none is near, the whole section does.
 */
export function nearestSeatToRay(t: SeatTable, r: { start: number; end: number }, o: V3, d: V3, hit?: V3): number {
  if (hit) {
    const near: number[] = [];
    for (let i = r.start; i < r.end; i++)
      if (Math.hypot(t.pos[i * 3] - hit[0], t.pos[i * 3 + 1] - hit[1], t.pos[i * 3 + 2] + SEAT_CENTRE_M - hit[2]) < PICK_NEAR_M) near.push(i);
    if (near.length) return closest(t, near, o, d);
  }
  const all: number[] = [];
  for (let i = r.start; i < r.end; i++) all.push(i);
  return closest(t, all, o, d);
}

function closest(t: SeatTable, ids: number[], o: V3, d: V3) {
  let best = -1, bestD = Infinity;
  for (const i of ids) {
    const vx = t.pos[i * 3] - o[0], vy = t.pos[i * 3 + 1] - o[1], vz = t.pos[i * 3 + 2] + SEAT_CENTRE_M - o[2];
    const s = vx * d[0] + vy * d[1] + vz * d[2];
    if (s <= 0) continue;
    const d2 = vx * vx + vy * vy + vz * vz - s * s;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  return best;
}
