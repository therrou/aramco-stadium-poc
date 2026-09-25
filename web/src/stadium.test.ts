import { expect, it } from "vitest";
import * as THREE from "three";
import { splitByGroup, GROUND_RE, OVERLAY_RE, SAIL_COAT, overlayOffset, patchLightsChunk, toCoatedSail } from "./stadium";

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
it("sail skin becomes a clear-coated physical copy with the same PBR values", () => {
  const m = new THREE.MeshStandardMaterial({ name: "M_SailSkin.web", metalness: 0.9, roughness: 0.24 });
  m.userData.special = "sailLeds";
  const p = toCoatedSail(m);
  expect(p.isMeshPhysicalMaterial).toBe(true);
  expect(p.defines).toEqual({ STANDARD: "", PHYSICAL: "" });
  expect([p.name, p.metalness, p.roughness, p.userData.special]).toEqual(["M_SailSkin.web", 0.9, 0.24, "sailLeds"]);
  expect([p.clearcoat, p.clearcoatRoughness]).toEqual([SAIL_COAT.clearcoat, SAIL_COAT.clearcoatRoughness]);
});
it("the lights chunk patch leaves the clear coat IBL path in place", () => {
  expect(patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps)).toContain("clearcoatRadiance += getIBLRadiance");
});
it("ground materials by name", () => {
  for (const m of ["M_Sand.web", "M_Lawn.web", "M_Asphalt.web", "M_Paving.web", "M_Plaza.web"]) expect(GROUND_RE.test(m)).toBe(true);
  expect(GROUND_RE.test("M_SailSkin.web")).toBe(false);
});
it("a material shared across lightmap groups gets one copy per group (same name)", () => {
  const root = new THREE.Group(), m = new THREE.MeshStandardMaterial({ name: "M_Lawn.web" });
  const mk = (g: string) => { const x = new THREE.Mesh(new THREE.BufferGeometry(), m); x.userData.lightmap = g; root.add(x); return x; };
  const a = mk("site"), b = mk("site_near"), c = mk("site_near");
  expect(splitByGroup(root)).toBe(1);
  expect(a.material).toBe(m);
  expect(b.material).not.toBe(m);
  expect(c.material).toBe(b.material);
  expect((b.material as THREE.Material).name).toBe("M_Lawn.web");
});
