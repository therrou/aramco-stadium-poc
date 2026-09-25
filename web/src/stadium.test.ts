import { expect, it } from "vitest";
import * as THREE from "three";
import { splitByGroup, GROUND_RE, OVERLAY_RE, SAIL_COAT, SPEC_OCC, overlayOffset, patchLightsChunk, specOccK, toCoatedSail } from "./stadium";

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
it("every IBL radiance sample in the patched chunk is blended with the B env (clear coat too)", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal");
  // each getIBLRadiance( call must be the first argument of a mix(...) with getIBLRadianceB
  const calls = out.match(/getIBLRadiance\(/g) ?? [];
  const blended = out.match(/mix\( getIBLRadiance\([^;]*getIBLRadianceB\([^;]*uEnvBlend \)/g) ?? [];
  expect(calls.length).toBe(2);
  expect(blended.length).toBe(calls.length);
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
it("A1: sky and clear-coat reflections are scaled by the lightmap specular occlusion", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("float lmSo = lmSpecOcc( lightMapIrradiance );");
  expect(out).toMatch(/vec3 iblRadiance = mix\([^;]*uEnvBlend \) \* lmSo;/);
  expect(out).toMatch(/clearcoatRadiance \+= mix\([^;]*uEnvBlend \) \* lmSo;/);
  // lmSo exists even without a lightmap (fallback path compiles)
  expect(out).toMatch(/#else\s*float lmSo = 1\.0;/);
});
it("A1: the occlusion scale K follows the lighting state", () => {
  expect(specOccK(0)).toBe(SPEC_OCC.k.day);
  expect(specOccK(0.6)).toBeCloseTo(SPEC_OCC.k.golden, 9);
  expect(specOccK(1)).toBe(SPEC_OCC.k.night);
  expect(specOccK(0.3)).toBeCloseTo((SPEC_OCC.k.day + SPEC_OCC.k.golden) / 2, 9);
  expect(SPEC_OCC.min).toBeGreaterThan(0);
});
