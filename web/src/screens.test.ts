import { expect, it } from "vitest";
import { SCREEN, isScreen, playerAt, screenPhase } from "./screens";

it("v4 screens: the feed loops seamlessly every SCREEN.loopS seconds", () => {
  for (const k of [0, 5, 11]) {
    const a = playerAt(k, 0.3), b = playerAt(k, 0.3 + SCREEN.loopS);
    expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9);
  }
  expect(screenPhase(1).ad).toBe(0);                              // match
  expect(screenPhase(SCREEN.adFrom + 0.6).ad).toBe(1);           // ad cut
  expect(screenPhase(SCREEN.loopS - 1e-6).ad).toBeLessThan(0.01); // fades back before the loop wraps
  expect(isScreen("M_Screen.web")).toBe(true);
  expect(isScreen("M_ScreenFrame.web")).toBe(false);
});
