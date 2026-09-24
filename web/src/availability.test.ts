import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mockAvailability } from "./availability";
import type { SeatTable } from "./seatsData";
import { indexSections } from "./seatsData";

function realTable(): SeatTable {                        // from data/seats.csv (committed)
  const rows = readFileSync(new URL("../../data/seats.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  const n = rows.length, t: SeatTable = { count: n, section: new Uint16Array(n), row: new Uint8Array(n), seat: new Uint16Array(n), pos: new Float32Array(n * 3), yaw: new Float32Array(n) };
  rows.forEach((r, i) => { const [s, ro, se, x, y, z, yaw] = r.split(",").map(Number); t.section[i] = s; t.row[i] = ro; t.seat[i] = se; t.pos.set([x, y, z], i * 3); t.yaw[i] = yaw; });
  return t;
}

it("is seeded, ~35% taken, and clustered", () => {
  const t = realTable(), idx = indexSections(t);
  const a = mockAvailability(t, idx, 7), b = mockAvailability(t, idx, 7);
  expect(a).toEqual(b);
  const taken = a.reduce((s, v) => s + v, 0) / a.length;
  expect(taken).toBeGreaterThan(0.3);
  expect(taken).toBeLessThan(0.4);
  let changes = 0;                                         // runs, not salt-and-pepper
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) changes++;
  expect(changes / a.length).toBeLessThan(0.2);
  const rates = [...idx.values()].map(({ start, end }) => a.slice(start, end).reduce((s, v) => s + v, 0) / (end - start));
  expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.3); // sections differ
});
