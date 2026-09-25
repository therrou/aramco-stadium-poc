import type { V3 } from "./coords";
import type { SeatTable } from "./seatsData";

/** Height of a seat's visual centre above its tread origin (seat back top ~0.93 m, pan 0.44 m). */
export const SEAT_CENTRE_M = 0.6;

/**
 * Seat of one section (index range r) whose centre is closest to the ray o + s d (Blender coords, d unit,
 * s > 0). The section comes from the section-strip raycast, so this runs over <= ~600 seats per pick.
 */
export function nearestSeatToRay(t: SeatTable, r: { start: number; end: number }, o: V3, d: V3) {
  let best = -1, bestD = Infinity;
  for (let i = r.start; i < r.end; i++) {
    const vx = t.pos[i * 3] - o[0], vy = t.pos[i * 3 + 1] - o[1], vz = t.pos[i * 3 + 2] + SEAT_CENTRE_M - o[2];
    const s = vx * d[0] + vy * d[1] + vz * d[2];
    if (s <= 0) continue;
    const d2 = vx * vx + vy * vy + vz * vz - s * s;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  return best;
}
