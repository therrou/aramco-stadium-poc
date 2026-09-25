import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { seatViewPose, verticalFov, SEAT_EYE_M, SEAT_HFOV, SEAT_LOOK_M } from "./flyto";
import { visibleSections, SEAT_LOD_DIST } from "./seats";
import type { SectionsDoc } from "./loader";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));

describe("fov (Review Focus 3)", () => {
  it("Blender AUTO fit: hfov applies to the larger side", () => {
    expect(verticalFov(62, 16 / 9)).toBeCloseTo(37.35, 2);
    expect(verticalFov(62, 9 / 16)).toBeCloseTo(62, 6);     // portrait: the larger side is vertical
    expect(verticalFov(62, 1)).toBeCloseTo(62, 6);
  });
});

describe("seat view pose (spec part 2)", () => {
  it("eye 1.2 m above the seat, looking at the pitch centre, target just ahead", () => {
    const p = seatViewPose([0, -60, 8]);
    expect(p.eye).toEqual([0, -60, 8 + SEAT_EYE_M]);
    expect(p.hfov).toBe(SEAT_HFOV);
    const d = p.target.map((v, k) => v - p.eye[k]);
    expect(Math.hypot(...d)).toBeCloseTo(SEAT_LOOK_M, 9);
    const toCentre = p.eye.map((v) => -v), n = Math.hypot(...toCentre);
    d.forEach((v, k) => expect(v / SEAT_LOOK_M).toBeCloseTo(toCentre[k] / n, 9));
  });
  it("worst-case visible seats from any section's seat view stays <= 25k (decision D6)", () => {
    let worst = 0;
    for (const s of doc.sections) {
      const ids = visibleSections(s.view.eye, doc.sections, SEAT_LOD_DIST, Number(s.id));
      worst = Math.max(worst, doc.sections.filter((x) => ids.has(Number(x.id))).reduce((a, x) => a + x.seats, 0));
    }
    expect(worst).toBeLessThanOrEqual(25_000);
  });
});
