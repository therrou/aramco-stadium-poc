import { expect, it } from "vitest";
import * as THREE from "three";
import { BLOOM } from "./lighting";
import { BOARDS, LED_EMISSIVE_GLSL } from "./ledBoards";
import { PARS, SIGN, SIGN_RE, sailGlow, PAVING_LIFT_M, PAVING_LIFT_RE, DUGOUT_GLASS, DUGOUT_GLASS_RE, FLOOD_LENS_MAX, LED_CELL, LED_COVER, LED_GLSL, LED_MAX, LED_R, setupStadiumMaterials } from "./stadium";
import { splitByGroup, GROUND_ENV, OVERLAY_RE, SAIL_NIGHT_ENV, SAIL_RE, envIntensityOf, sailEnvIntensity, SAIL_COAT, SPEC_OCC, SAIL_NIGHT_E, lightsChunkFor, overlayOffset, soMinDefine, patchLightsChunk, specOccK, toCoatedSail } from "./stadium";

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
it("A2: reflection strength by material name; unlisted materials keep 1", () => {
  for (const m of ["M_Sand.web", "M_Lawn.web", "M_Asphalt.web", "M_Paving.web", "M_Plaza.web"]) expect(envIntensityOf(m)).toBe(GROUND_ENV);
  expect(envIntensityOf("M_ConcourseGlass.web")).toBe(0.3);
  expect(envIntensityOf("M_SuiteGlass.web")).toBe(0.3);
  expect(envIntensityOf("M_Grass.web")).toBe(0.2);
  expect(envIntensityOf("M_Steel.web")).toBe(0.5);
  expect(envIntensityOf("M_SailSkin.web")).toBeUndefined();
  expect(envIntensityOf("M_GrassX.web")).toBeUndefined();
});
it("A5: sail reflections fade toward SAIL_NIGHT_ENV at night", () => {
  expect(sailEnvIntensity(0)).toBe(1);
  expect(sailEnvIntensity(1)).toBeCloseTo(SAIL_NIGHT_ENV, 9);
  expect(SAIL_RE.test("M_SailSkin.web")).toBe(true);
  expect(SAIL_RE.test("M_SailUnder.web")).toBe(false);
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
it("A3: LED dots are pixel-footprint aware, never a hard step", () => {
  expect(LED_GLSL).toContain("fwidth( pB )");
  expect(LED_GLSL).not.toMatch(/step\( length\(/);
  expect(LED_GLSL).toContain(LED_COVER.toExponential(4));
});
it("A3: 3D dot lattice matches the Cycles 2D Voronoi (shell.py: 1.1 m cells, r 0.05 cell) in dots per m^2 and coverage", () => {
  // a plane crosses spheres of radius r in cells c: 2r / c^3 dots per m^2 covering (4/3) pi r^3 / c^3 of it
  expect(2 * LED_R / LED_CELL ** 3).toBeCloseTo(1 / 1.1 ** 2, 2);
  expect(LED_COVER).toBeCloseTo(Math.PI * 0.055 ** 2 / 1.1 ** 2, 4);
  expect(LED_COVER).toBeCloseTo((4 / 3) * Math.PI * LED_R ** 3 / LED_CELL ** 3, 12);
  expect(LED_GLSL).toContain(`floor( pB / ${LED_CELL.toFixed(4)} )`);
});
it("A3: LED radiance stays below the bloom threshold, so single LEDs never bloom", () => {
  expect(LED_MAX).toBeLessThan(BLOOM.threshold);
});
it("A4: flood lens night emission is capped and the lens is single-sided", () => {
  const root = new THREE.Group();
  const lens = new THREE.MeshStandardMaterial({ name: "M_FloodLens.web", side: THREE.DoubleSide });
  lens.userData = { emDay: 0, emNight: 120 };
  const other = new THREE.MeshStandardMaterial({ name: "M_Glow.web" });
  other.userData = { emDay: 0, emNight: 120 };
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), lens), new THREE.Mesh(new THREE.BufferGeometry(), other));
  const shared = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: 16 }, uLmGamma: { value: 0 }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  setupStadiumMaterials(root, shared, false);
  expect(lens.userData.emNight).toBe(FLOOD_LENS_MAX);
  expect(lens.side).toBe(THREE.FrontSide);
  expect(other.userData.emNight).toBe(120);
});
it("A1/A5: the sail skin has its own, higher occlusion floor (the coarse night sail lightmap showed as blocks)", () => {
  expect(SPEC_OCC.sailMin).toBeGreaterThan(SPEC_OCC.min);
  expect(soMinDefine("sailLeds")).toContain(`#define SO_MIN ${SPEC_OCC.sailMin.toFixed(3)}`);
  expect(soMinDefine(undefined)).toContain(`#define SO_MIN ${SPEC_OCC.min.toFixed(3)}`);
});
it("D6: at night the sail skin's lighting blends to the smooth measured level (the night sail bake is noise around 0.2)", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toMatch(/#ifdef SAIL_SKIN\s*lightMapIrradiance = mix\( lightMapIrradiance, sailNightIrradiance\( vWorldPosB \), smoothstep\( 0\.6, 1\.0, uNight \) \);/);
  expect(SAIL_NIGHT_E).toBeCloseTo(0.21, 2);
  expect(soMinDefine("sailLeds")).toContain("#define SAIL_SKIN");
  expect(soMinDefine(undefined)).not.toContain("SAIL_SKIN");
});
it("D5: the ground's night glow is part of the lights chunk it actually compiles (ordering bug)", () => {
  const chunk = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(lightsChunkFor(chunk, true, false, "ground")).toContain("irradiance += podiumGlow( vWorldPosB ) * uNight;");
  expect(lightsChunkFor(chunk, true, false, "concrete")).not.toContain("podiumGlow");
  expect(lightsChunkFor(chunk, false, false, "ground")).toContain("podiumGlow");   // also without lightmaps
});
it("v3: surface textures get anisotropic filtering (grazing ground showed moire stripes)", () => {
  const root = new THREE.Group(), tex = new THREE.Texture(), nrm = new THREE.Texture();
  const m = new THREE.MeshStandardMaterial({ name: "M_Lawn.web", map: tex, normalMap: nrm });
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
  const shared = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: 16 }, uLmGamma: { value: 0 }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  setupStadiumMaterials(root, shared, false, false, 16);
  expect([tex.anisotropy, nrm.anisotropy]).toEqual([8, 8]);
});
it("LED ad boards: lit by their ad (day and night strengths), black surface, own program", () => {
  const root = new THREE.Group(), m = new THREE.MeshStandardMaterial({ name: "M_LEDBoard.web" });
  m.userData = { emDay: 0.3, emNight: 5 };
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
  const shared = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: 16 }, uLmGamma: { value: 0 }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  setupStadiumMaterials(root, shared, true);
  expect([m.userData.emDay, m.userData.emNight]).toEqual([BOARDS.emDay, BOARDS.emNight]);
  expect(m.emissive.getHex()).toBe(0xffffff);
  expect(m.customProgramCacheKey()).toContain("-led");
  const s = { uniforms: {}, vertexShader: "#include <common>\n#include <worldpos_vertex>", fragmentShader: "#include <envmap_physical_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <map_fragment>\n#include <emissivemap_fragment>\n#include <lights_fragment_maps>" } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(s, {} as THREE.WebGLRenderer);
  expect(s.fragmentShader).toContain(LED_EMISSIVE_GLSL);
  expect(Object.keys(s.uniforms)).toContain("uAds");
});

it("v4 sail glow: only between day and night, stronger toward the base", () => {
  expect(sailGlow(20, 0)).toBe(0);
  expect(sailGlow(20, 1)).toBe(0);
  expect(sailGlow(12, 0.6)).toBeGreaterThan(sailGlow(50, 0.6));
  expect(sailGlow(50, 0.6)).toBeCloseTo(1.5 * 0.35 * 0.4 * 0.6, 5);   // top: underside glow 1 x n
});

it("v4 dugout canopy glass is translucent and daylit, not the dark baked underside", () => {
  expect(DUGOUT_GLASS_RE.test("M_DugoutGlass.web")).toBe(true);
  expect(DUGOUT_GLASS_RE.test("M_ConcourseGlass.web")).toBe(false);
  expect(DUGOUT_GLASS.opacity).toBeLessThan(0.5);                 // still see-through
  expect(DUGOUT_GLASS.lmBoost).toBeGreaterThan(1);
  expect(DUGOUT_GLASS.emDay).toBeGreaterThan(DUGOUT_GLASS.emNight);  // milky by day, not a lamp at night
});

it("v4: paving (not the plaza disc) is lifted over the coplanar lawn by more than a quantization step (~4 cm)", () => {
  expect(PAVING_LIFT_RE.test("M_Paving.web")).toBe(true);
  expect(PAVING_LIFT_RE.test("M_Plaza.web")).toBe(false);   // the plaza disc runs under the pitch
  expect(PAVING_LIFT_RE.test("M_Lawn.web")).toBe(false);
  expect(PAVING_LIFT_M).toBeGreaterThan(0.04);
  expect(PAVING_LIFT_M).toBeLessThan(0.1);
});

it("v4: lightmaps decode as gamma RGB when the manifest sets lmGamma, RGBM otherwise", () => {
  const chunk = THREE.ShaderChunk.lights_fragment_maps;
  expect(patchLightsChunk(chunk)).toContain("rgbmDecode");
  const pars = PARS;
  expect(pars).toContain("uniform float uLmGamma;");
  expect(pars).toContain("pow( max( c.rgb, vec3( 0.0 ) ), vec3( uLmGamma ) ) * uRgbmRange");
});

it("v4: the sign lights itself evenly, well below its 14x bake emission", () => {
  expect(SIGN_RE.test("M_SignWhite.web")).toBe(true);
  expect(SIGN.emNight).toBeLessThan(4);
  expect(SIGN.lm).toBeLessThan(0.5);
});
