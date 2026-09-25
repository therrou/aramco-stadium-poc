import { expect, it } from "vitest";
import { SectionPatches } from "./sectionPatches";
import { tierAlbedo } from "./tiers";
import type { SeatTable } from "./seatsData";

/** Two rows x two seats in one section, 1 m apart. */
function smallTable(section = 212): SeatTable {
  const pos = new Float32Array([0, -50, 5, 1, -50, 5, 0, -51, 5.4, 1, -51, 5.4]);
  return { count: 4, section: new Uint16Array(4).fill(section), row: new Uint8Array([1, 1, 2, 2]), seat: new Uint16Array([1, 2, 1, 2]), pos, yaw: new Float32Array(4) };
}
it("A6: patches take the tier albedo; faces map to their section", () => {
  const p = new SectionPatches(smallTable(), new Map([[212, { start: 0, end: 4 }]]), undefined, () => "Club");
  const col = p.mesh.geometry.getAttribute("color"), c = tierAlbedo("Club");
  expect([col.getX(0), col.getY(0), col.getZ(0)].map((v) => v.toFixed(5))).toEqual([c.r, c.g, c.b].map((v) => v.toFixed(5)));
  expect(p.sectionOfFace(0)).toBe(212);
  expect(p.sectionOfFace(1)).toBe(212);
  expect(p.sectionOfFace(2)).toBe(-1);
});
import { SEAT_ROWS_GLSL } from "./sectionPatches";
it("D7: far stands carry a row coordinate (metres along the row, 0 -> 1 across to the next row) for the seat pattern", () => {
  const p = new SectionPatches(smallTable(), new Map([[212, { start: 0, end: 4 }]]), undefined, () => "Lower");
  const uv = p.mesh.geometry.getAttribute("aRowUV");
  const us = [...Array(uv.count).keys()].map((i) => uv.getX(i)), vs = [...Array(uv.count).keys()].map((i) => uv.getY(i));
  expect(Math.min(...us)).toBe(0);
  expect(Math.max(...us)).toBeCloseTo(1, 5);          // seats 1 m apart in the fixture
  expect(new Set(vs)).toEqual(new Set([0, 1]));
  expect(SEAT_ROWS_GLSL).toContain("float seatRows( vec2 uv, float seatW )");
});
