import { expect, it } from "vitest";
import { poseAt } from "./camera";
import type { Pose } from "./flyto";

const A: Pose = { eye: [0, -20, 35], target: [0, 0, 0], hfov: 50 };
const B: Pose = { eye: [10, -50, 8], target: [2, -11, 0], hfov: 55 };
const C: Pose = { eye: [-40, 20, 30], target: [0, 0, 0], hfov: 50 };

it("poseAt hits both ends and eases", () => {
  expect(poseAt(A, B, 0)).toEqual(A);
  expect(poseAt(A, B, 1)).toEqual(B);
  expect(poseAt(A, B, 0.1).eye[0]).toBeLessThan(1);          // slow start
});

it("re-targeting mid-flight starts from the current in-between pose (Review Focus 2)", () => {
  const mid = poseAt(A, B, 0.4);
  expect(poseAt(mid, C, 0)).toEqual(mid);
  expect(poseAt(mid, C, 0.01).eye[0]).toBeCloseTo(mid.eye[0], 0);
});
