import { expect, it } from "vitest";
import * as THREE from "three";
import { OVERLAY_RE, overlayOffset, patchLightsChunk } from "./stadium";

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
it("offsets only the flat overlay materials, toward the camera in both depth modes", () => {
  for (const m of ["M_RoadLine.web", "M_StreetGlow.web", "M_PodiumStrip.web", "M_LineWhite.web"]) expect(OVERLAY_RE.test(m)).toBe(true);
  for (const m of ["M_Asphalt.web", "M_Lawn.web", "M_Grass.web", "M_RoadLineX.web"]) expect(OVERLAY_RE.test(m)).toBe(false);
  expect(overlayOffset(false)).toEqual({ factor: -1, units: -4 });
  expect(overlayOffset(true)).toEqual({ factor: -1, units: 4 });   // three flips factor itself, not units
});
