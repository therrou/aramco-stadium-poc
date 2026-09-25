import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SunShadow, SHADOW, SUN_VIS_GLSL } from "./sunShadow";
import { sunToward } from "./lightingState";
import { toThree } from "./coords";
import { patchLightsChunk } from "./stadium";
import { OUTDOOR_IRRADIANCE } from "./treeLight";

describe("S1 sun shadows", () => {
  it("one shadow-casting sun covering the stadium, 4096 map, rendered only when the sun moves", () => {
    const renderer = { shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false, type: 0 } } as unknown as THREE.WebGLRenderer;
    const scene = new THREE.Scene(), sh = new SunShadow(renderer, scene);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(sh.light.castShadow).toBe(true);
    expect(sh.light.intensity).toBe(0);                       // only the shadow is used; the sun is in the lightmaps
    expect(sh.light.shadow.mapSize.x).toBe(SHADOW.mapSize);
    expect(sh.light.shadow.camera.layers.isEnabled(2)).toBe(true);   // trees and far site live on layer 2
    const cam = sh.light.shadow.camera as THREE.OrthographicCamera;
    expect(cam.right - cam.left).toBeCloseTo(2 * SHADOW.radius, 6);
    renderer.shadowMap.needsUpdate = false;
    sh.update(0);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    const dir = sh.light.position.clone().sub(sh.light.target.position).normalize();
    expect(dir.distanceTo(toThree(sunToward(0)).normalize())).toBeLessThan(1e-6);
    renderer.shadowMap.needsUpdate = false;
    sh.update(0);
    expect(renderer.shadowMap.needsUpdate).toBe(false);        // same sun: no re-render
    sh.update(0.6);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });
  it("sharpens the baked sun: the direct sun is taken out where the live shadow map says shadow", () => {
    const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
    expect(out).toContain("sunVisibility()");
    expect(out).toMatch(/#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 0/);
    expect(SUN_VIS_GLSL).toContain("float sunVisibility()");
  });
  it("seats, patches and trees take the live sun visibility instead of the bowl factor for the sun term", () => {
    expect(OUTDOOR_IRRADIANCE).toContain("sunVisibility()");
  });
});

describe("S2 ruling: live shadows only outside the shell", () => {
  it("the lightmap sharpening and the outdoor sun fade out inside the shell (the bowl's light is the bake's)", () => {
    const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
    expect(out).toContain("outsideShell( vWorldPosB )");
    expect(OUTDOOR_IRRADIANCE).toContain("( 1.0 - floodMask( vFloodPos ) )");
    expect(SUN_VIS_GLSL).toContain("float outsideShell( vec3 pB )");
    expect(SHADOW.radius).toBeGreaterThanOrEqual(300);
  });
});

it("S1 (final review 4): the live shadow only takes baked sun away, never adds it, and only inside the map", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("es * vb * ( 1.0 - sunVisibility() ) * outsideShell( vWorldPosB ) * sunInShadowMap()");
  expect(out).not.toContain("+ es * sunVisibility()");
});
