import { expect, it } from "vitest";
import { nearestSeatToRay, SEAT_CENTRE_M } from "./seatPick";
import type { SeatTable } from "./seatsData";

const t: SeatTable = { count: 3, section: new Uint16Array(3).fill(101), row: new Uint8Array([1, 1, 2]), seat: new Uint16Array([1, 2, 1]),
  pos: new Float32Array([0, -50, 5, 0.5, -50, 5, 0, -51, 5.4]), yaw: new Float32Array(3) };
it("picks the seat whose centre is nearest the ray", () => {
  // ray from above the pitch toward seat 2's centre
  const target = [0.5, -50, 5 + SEAT_CENTRE_M], o: [number, number, number] = [0.5, 0, 30];
  const d = target.map((v, k) => v - o[k]), n = Math.hypot(...d);
  expect(nearestSeatToRay(t, { start: 0, end: 3 }, o, d.map((v) => v / n) as [number, number, number])).toBe(1);
});
it("ignores seats behind the ray origin", () => {
  expect(nearestSeatToRay(t, { start: 0, end: 3 }, [0, -40, 5], [0, 1, 0])).toBe(-1);
});
it("final review: at grazing angles the seat near the strip hit wins over a farther seat nearer the ray line", () => {
  const row: SeatTable = { count: 2, section: new Uint16Array(2).fill(101), row: new Uint8Array([1, 1]), seat: new Uint16Array([1, 2]),
    pos: new Float32Array([0, -50, 5, 10, -50, 5]), yaw: new Float32Array(2) };
  // looking along the row, slightly closer to seat 2's centre line; the strip was hit next to seat 1
  const o: [number, number, number] = [-5, -50, 5 + SEAT_CENTRE_M + 0.3], d = [1, 0, -0.03], n = Math.hypot(...d);
  expect(nearestSeatToRay(row, { start: 0, end: 2 }, o, d.map((v) => v / n) as [number, number, number], [0.2, -50, 5.5])).toBe(0);
});
