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

import { seatGeometryHi, SEAT_NEAR_M } from "./seats";
describe("D7 moulded seat near the camera", () => {
  it("about 150-200 triangles, same footprint as the block seat, contact shading in vertex colours", () => {
    const g = seatGeometryHi(), tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    expect(tris).toBeGreaterThanOrEqual(120);
    expect(tris).toBeLessThanOrEqual(200);
    g.computeBoundingBox(); const lo = seatGeometry(); lo.computeBoundingBox();
    const b = g.boundingBox!, l = lo.boundingBox!;
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(l.max.z - l.min.z + 1e-6);   // no wider than its seat slot
    expect(b.max.y).toBeLessThan(1.0);
    const c = g.getAttribute("color");
    let min = 1, max = 0; for (let i = 0; i < c.count; i++) { min = Math.min(min, c.getX(i)); max = Math.max(max, c.getX(i)); }
    expect(min).toBeLessThan(0.7);                                          // undersides and stem darker
    expect(max).toBe(1);
  });
  it("near sections draw the moulded seat, the rest the block; each seat in exactly one mesh", () => {
    const t = { count: 3, section: new Uint16Array([101, 101, 201]), row: new Uint8Array(3), seat: new Uint16Array(3), pos: new Float32Array(9), yaw: new Float32Array(3) };
    const f = new SeatField(t, new Map([[101, { start: 0, end: 2 }], [201, { start: 2, end: 3 }]]), doc.sections);
    f.setVisibleSections(new Set([101, 201]), new Set([101]));
    expect([f.near.count, f.mesh.count]).toEqual([2, 1]);
    f.setVisibleSections(new Set([101, 201]), new Set());
    expect([f.near.count, f.mesh.count]).toEqual([0, 3]);
    expect(SEAT_NEAR_M).toBeGreaterThan(20);
  });
});

import { nearSections, NEAR_SEAT_CAP } from "./seats";
it("D7: moulded seats go to the nearest sections first, within a seat budget (triangle budget, D6)", () => {
  const cam: [number, number, number] = doc.sections[0].view.eye;
  const ids = nearSections(cam, doc.sections, SEAT_NEAR_M, NEAR_SEAT_CAP);
  const bySeats = doc.sections.filter((s) => ids.has(Number(s.id))).reduce((a, s) => a + s.seats, 0);
  expect(bySeats).toBeLessThanOrEqual(NEAR_SEAT_CAP);
  expect(ids.has(Number(doc.sections[0].id))).toBe(true);           // the camera's own section first
  for (const s of doc.sections) {
    let worst = 0;
    const n = nearSections(s.view.eye, doc.sections, SEAT_NEAR_M, NEAR_SEAT_CAP);
    worst = Math.max(worst, doc.sections.filter((x) => n.has(Number(x.id))).reduce((a, x) => a + x.seats, 0));
    expect(worst).toBeLessThanOrEqual(NEAR_SEAT_CAP);
  }
});
