import { expect, it } from "vitest";
import * as THREE from "three";
import { FLOOD, FLOOD_GLSL, OUTDOOR_IRRADIANCE, BOWL, bowlFactor, floodMask, makeTreeUniforms, shellRadius, updateTreeUniforms } from "./treeLight";

it("floodlight mask: full inside the bowl, zero outside the shell", () => {
  expect(floodMask(0, 0)).toBe(1);
  expect(floodMask(80, 60)).toBe(1);                       // upper tier corner, radius < 0.9
  expect(shellRadius(FLOOD.a, 0)).toBeCloseTo(1);
  expect(floodMask(FLOOD.a, 0)).toBe(0);
  expect(floodMask(170, 0)).toBe(0);                       // near trees start ~140-170 m out
  const mid = floodMask(0.95 * FLOOD.a, 0);
  expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
});
it("floodlight irradiance scales with night and is zero by day", () => {
  const u = makeTreeUniforms(), cam = new THREE.PerspectiveCamera();
  updateTreeUniforms(u, 0, cam);
  expect(u.uFlood.value.getHex()).toBe(0);
  updateTreeUniforms(u, 1, cam);
  expect(u.uFlood.value.g).toBeCloseTo(FLOOD.irradiance * FLOOD.color[1]);
});
it("the shader term uses the same superellipse", () => {
  expect(FLOOD_GLSL).toContain(`abs( w.x / ${FLOOD.a.toFixed(1)} )`);
  expect(OUTDOOR_IRRADIANCE).toContain("floodMask( vFloodPos )");
});

it("A6: inside the bowl the outdoor light is scaled by the measured per-state bowl factor", () => {
  expect(bowlFactor(0)).toBe(BOWL.day);
  expect(bowlFactor(0.6)).toBeCloseTo(BOWL.golden, 9);
  expect(bowlFactor(1)).toBe(BOWL.night);
  const u = makeTreeUniforms(), cam = new THREE.PerspectiveCamera();
  cam.updateMatrixWorld();
  updateTreeUniforms(u, 0, cam);
  expect(u.uBowl.value).toBe(BOWL.day);
  // ambient + sun are scaled inside the shell only (floodMask); the flood term is not
  expect(OUTDOOR_IRRADIANCE).toContain("bowlK = mix( 1.0, uBowl, floodMask( vFloodPos ) )");
  expect(OUTDOOR_IRRADIANCE).toContain("PI * uAmbient * bowlK");
});
