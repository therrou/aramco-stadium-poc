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
