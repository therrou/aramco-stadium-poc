import { expect, it } from "vitest";
import { patchColor } from "./sectionPatches";
import { SEAT_COLORS } from "./seats";

it("patch colours match the legend: club cream, others green, both toward taken grey", () => {
  expect(patchColor("Club", 0).getHex()).toBe(SEAT_COLORS.club);
  expect(patchColor("Lower", 0).getHex()).toBe(SEAT_COLORS.available);
  expect(patchColor("Upper", 1).getHex()).toBe(SEAT_COLORS.taken);
  expect(patchColor("Club", 1).getHex()).toBe(SEAT_COLORS.taken);
  const half = patchColor("Club", 0.5);
  expect(half.getHex()).not.toBe(patchColor("Lower", 0.5).getHex());
});
