import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { seatGeometry, seatColor, SEAT_COLORS, visibleSections, SEAT_LOD_DIST } from "./seats";
import type { SectionsDoc } from "./loader";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));

describe("seats", () => {
  it("seat model is at most 24 triangles (decision D6)", () => {
    const g = seatGeometry();
    expect((g.index ? g.index.count : g.attributes.position.count) / 3).toBeLessThanOrEqual(24);
  });
  it("colours by tier and availability", () => {
    expect(seatColor("Lower", 0)).toBe(SEAT_COLORS.available);
    expect(seatColor("Club", 0)).toBe(SEAT_COLORS.club);
    expect(seatColor("Club", 1)).toBe(SEAT_COLORS.taken);
    expect(seatColor("Upper", 1)).toBe(SEAT_COLORS.taken);
  });
  it("overview camera shows no individual seats", () => {
    expect(visibleSections([-330, -470, 230], doc.sections, SEAT_LOD_DIST).size).toBe(0);
  });
});
