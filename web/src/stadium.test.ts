import { expect, it } from "vitest";
import * as THREE from "three";
import { patchLightsChunk } from "./stadium";

it("patches three r186 lights_fragment_maps (lightmap blend, no diffuse IBL, env blend)", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("rgbmDecode");
  expect(out).toContain("uLmBlend");
  expect(out).not.toContain("getIBLIrradiance");
  expect(out).toContain("getIBLRadianceB");
});
it("throws when three's chunk no longer matches", () => {
  expect(() => patchLightsChunk("void main(){}")).toThrow(/three.js/);
});
