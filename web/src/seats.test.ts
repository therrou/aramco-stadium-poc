import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SeatField, seatGeometry, visibleSections, SEAT_LOD_DIST } from "./seats";
import { tierAlbedo } from "./tiers";
import type { SectionsDoc } from "./loader";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));

describe("seats", () => {
  it("seat model is at most 24 triangles (decision D6)", () => {
    const g = seatGeometry();
    expect((g.index ? g.index.count : g.attributes.position.count) / 3).toBeLessThanOrEqual(24);
  });
  it("A6: seats are coloured by tier at the Cycles seat brightness", () => {
    const t = { count: 2, section: new Uint16Array([101, 201]), row: new Uint8Array(2), seat: new Uint16Array(2), pos: new Float32Array(6), yaw: new Float32Array(2) };
    const f = new SeatField(t, new Map([[101, { start: 0, end: 1 }], [201, { start: 1, end: 2 }]]), doc.sections);
    f.setVisibleSections(new Set([101, 201]));
    const col = f.mesh.instanceColor!.array, lower = tierAlbedo("Lower"), club = tierAlbedo("Club");
    expect([col[0], col[1], col[2]].map((v) => v.toFixed(5))).toEqual([lower.r, lower.g, lower.b].map((v) => v.toFixed(5)));
    expect([col[3], col[4], col[5]].map((v) => v.toFixed(5))).toEqual([club.r, club.g, club.b].map((v) => v.toFixed(5)));
  });
  it("overview camera shows no individual seats", () => {
    expect(visibleSections([-330, -470, 230], doc.sections, SEAT_LOD_DIST).size).toBe(0);
  });
});

import { pulse, SeatHighlight } from "./seats";
import * as THREE from "three";
it("selected seat highlight pulses between 0.35 and 0.9 and hides with no seat", () => {
  for (let t = 0; t < 3; t += 0.1) { expect(pulse(t)).toBeGreaterThanOrEqual(0.35); expect(pulse(t)).toBeLessThanOrEqual(0.9); }
  const h = new SeatHighlight();
  h.set(null);
  expect(h.mesh.visible).toBe(false);
  h.set(new THREE.Matrix4());
  expect(h.mesh.visible).toBe(true);
});
