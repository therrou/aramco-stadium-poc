import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { reflectionActive, PLANAR, isPlanarMaterial, PLANAR_GLSL } from "./planarReflect";
import { patchLightsChunk } from "./stadium";

describe("plaza reflection (v3, option 2)", () => {
  it("runs only when the plaza can be seen close: outside the bowl and below PLANAR.maxEyeZ", () => {
    expect(reflectionActive([-45.6, -228.7, 1.7])).toBe(true);      // CAM_Approach
    expect(reflectionActive([-330, -470, 230])).toBe(false);        // aerial: too high to matter
    expect(reflectionActive([-2.25, -57.5, 7.4])).toBe(false);      // seat view inside the bowl
  });
  it("glossy paving and plaza only", () => {
    expect(isPlanarMaterial("M_Paving.web")).toBe(true);
    expect(isPlanarMaterial("M_Plaza.web")).toBe(true);
    for (const m of ["M_Lawn.web", "M_Sand.web", "M_Asphalt.web", "M_Grass.web"]) expect(isPlanarMaterial(m)).toBe(false);
  });
  it("replaces the sky reflection with the scene's mirror image, through the surface's own BRDF", () => {
    const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
    expect(out).toMatch(/#ifdef PLANAR_REFLECT\s*iblRadiance = mix\( iblRadiance, planarReflection\( material\.roughness \), uReflectOn \);/);
    expect(PLANAR_GLSL).toContain("vec3 planarReflection( float roughness )");
    expect(PLANAR.gain.night).toBeGreaterThan(PLANAR.gain.day);
  });
});
