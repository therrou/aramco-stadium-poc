import { expect, it } from "vitest";
import { acceptPatchHit, PICK_EPS_M } from "./picking";

it("no patch hit -> nothing picked", () => {
  expect(acceptPatchHit(undefined, 10)).toBe(false);
  expect(acceptPatchHit(undefined, undefined)).toBe(false);
});
it("patch hit with nothing of the stadium on the ray -> picked", () => {
  expect(acceptPatchHit(120, undefined)).toBe(true);
});
it("patch in front of the building, or within eps behind its first surface -> picked", () => {
  expect(acceptPatchHit(80, 95)).toBe(true);
  expect(acceptPatchHit(95 + PICK_EPS_M * 0.9, 95)).toBe(true);
});
it("patch behind the building (seen through the roof) -> not picked", () => {
  expect(acceptPatchHit(140, 60)).toBe(false);
  expect(acceptPatchHit(95 + PICK_EPS_M * 1.1, 95)).toBe(false);
});
