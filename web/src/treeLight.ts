import * as THREE from "three";
import { toThree } from "./coords";
import { sunColor, sunStrength, sunToward, STATE_NIGHT } from "./lightingState";

/**
 * Outdoor light for everything that is not lightmapped (trees, seats, section patches): Blender's sun
 * (same formulas as lighting.py) plus a per-state ambient. With lightmaps there are no scene lights,
 * so without this those meshes render black (controller ruling R11).
 */
export interface TreeUniforms {
  uSunDirView: { value: THREE.Vector3 }; uSun: { value: THREE.Color }; uAmbient: { value: THREE.Color };
  /** Floodlight irradiance inside the bowl (Task 13b, D) and world up in view space. */
  uFlood: { value: THREE.Color }; uUpView: { value: THREE.Vector3 };
  /** A6 (v2): ambient + sun factor inside the shell plan. */
  uBowl: { value: number };
}
export type OutdoorUniforms = TreeUniforms;
export const TREE_AMBIENT = { day: 0.9, golden: 0.55, night: 0.12 };
/**
 * Stadium floodlights for the non-lightmapped seats and section patches (Task 13b, D). The Flood_* spots
 * (1500 W x n each, 55 deg cones) sit on the compression ring (z ~ 56 m) aimed at the pitch and bowl; the
 * web approximates them by a uniform irradiance inside the shell's plan superellipse (params.SHELL_*),
 * fading out over the last 10 % of its radius, times n. `irradiance` is W/m^2 like the sun (Blender units).
 */
// irradiance (fix round 1): measured from the night bowl lightmap, decoded RGBM x PI as stadium.ts applies it,
// at the centres of the 78,586 up-facing tier treads (bowl__M_Concrete, z > 1.5 m): mean (1.14, 1.18, 0.95),
// median 0.72. The night ambient already adds PI * 0.12 * ~0.87 = 0.33, so the flood term is 1.14 - 0.33 = 0.8.
// (6.0 before lit the seats ~5x brighter than the treads around them.)
export const FLOOD = { irradiance: 0.8, color: [0.95, 0.97, 1.0] as const, a: 138.0, b: 121.0, n: 2.25 };
export const makeTreeUniforms = (): TreeUniforms => ({ uSunDirView: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() },
  uFlood: { value: new THREE.Color() }, uUpView: { value: new THREE.Vector3() }, uBowl: { value: 1 } });

/** Plan superellipse "radius" of a Blender (x, y): 1 on the shell outline (same formula as FLOOD_GLSL). */
export const shellRadius = (x: number, y: number) => (Math.abs(x / FLOOD.a) ** FLOOD.n + Math.abs(y / FLOOD.b) ** FLOOD.n) ** (1 / FLOOD.n);
/** Floodlight weight at a plan position: 1 inside the bowl, 0 outside the shell. */
export const floodMask = (x: number, y: number) => 1 - THREE.MathUtils.smoothstep(shellRadius(x, y), 0.9, 1.0);

/**
 * A6 (v2): seats and section patches are not lightmapped, and inside the bowl the open-sky model above
 * (ambient + sun) lit them ~4x brighter than the treads they sit on: the roof, sails and stands block most
 * of the sky and the low sun. scripts/webexport/measure_bowl.py samples the up-facing treads of
 * bowl__M_Concrete in each state's bowl lightmap: day mean 0.80 vs model 3.59, golden (0.89 - flood 0.48)
 * vs 1.53. Open (under the oculus) and roofed treads differ little (day 0.70 / 0.84), so one factor applies
 * across the shell plan (floodMask). Night stays 1: FLOOD was calibrated against the full night ambient.
 */
export const BOWL = { day: 0.223, golden: 0.269, night: 1.0 };
export function bowlFactor(n: number) {
  const g = STATE_NIGHT.golden;
  return n <= g ? THREE.MathUtils.lerp(BOWL.day, BOWL.golden, n / g) : THREE.MathUtils.lerp(BOWL.golden, BOWL.night, (n - g) / (1 - g));
}

/** Trees aren't lightmapped: Blender's sun (same formulas) + a per-state ambient. `camera.matrixWorldInverse` must be current. */
export function updateTreeUniforms(u: TreeUniforms, n: number, camera: THREE.Camera) {
  u.uSunDirView.value.copy(toThree(sunToward(n))).transformDirection(camera.matrixWorldInverse);
  u.uSun.value.setRGB(...sunColor(n)).multiplyScalar(sunStrength(n));
  const g = STATE_NIGHT.golden;
  const amb = n <= g ? THREE.MathUtils.lerp(TREE_AMBIENT.day, TREE_AMBIENT.golden, n / g)
                     : THREE.MathUtils.lerp(TREE_AMBIENT.golden, TREE_AMBIENT.night, (n - g) / (1 - g));
  u.uAmbient.value.setRGB(amb * 0.8, amb * 0.87, amb);
  u.uFlood.value.setRGB(...FLOOD.color).multiplyScalar(FLOOD.irradiance * n);
  u.uUpView.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  u.uBowl.value = bowlFactor(n);
}

/** Leaves the uniforms at zero: used when the fallback scene lights are on (no lightmaps), so nothing is lit twice. */
export function clearTreeUniforms(u: TreeUniforms) {
  u.uSun.value.setRGB(0, 0, 0);
  u.uAmbient.value.setRGB(0, 0, 0);
  u.uFlood.value.setRGB(0, 0, 0);
}

/**
 * Irradiance added in lights_fragment_maps; RE_IndirectDiffuse multiplies by albedo / PI. The sun strength is
 * Blender's irradiance (W/m^2), as in the lightmaps (stored E/PI, scaled by lightMapIntensity = PI), so it is
 * added as-is: radiance = albedo * sun * N.L / PI, matching the baked surfaces. uAmbient is a sky radiance
 * over the hemisphere, hence PI * uAmbient. (The brief had PI * (ambient + sun): ~3x too bright next to the bake.)
 */
export const OUTDOOR_IRRADIANCE = "irradiance += ( PI * uAmbient + uSun * max( dot( geometryNormal, uSunDirView ), 0.0 ) ) * mix( 1.0, uBowl, floodMask( vFloodPos ) );\n" +
  // floodlights: from above the ring, so up-facing surfaces get the full term, vertical ones ~60 %
  "irradiance += uFlood * floodMask( vFloodPos ) * ( 0.6 + 0.4 * max( dot( geometryNormal, uUpView ), 0.0 ) );";
/** GLSL twin of floodMask (three world position: plan is x, -z). */
export const FLOOD_GLSL = /* glsl */ `
float floodMask( vec3 w ) {
  float r = pow( pow( abs( w.x / ${FLOOD.a.toFixed(1)} ), ${FLOOD.n.toFixed(2)} ) + pow( abs( w.z / ${FLOOD.b.toFixed(1)} ), ${FLOOD.n.toFixed(2)} ), ${(1 / FLOOD.n).toFixed(6)} );
  return 1.0 - smoothstep( 0.9, 1.0, r );
}`;

/**
 * Adds the outdoor sun + ambient to a MeshStandardMaterial. Composes with an existing onBeforeCompile
 * (e.g. SectionPatches' slot hiding) instead of replacing it. No alpha changes here.
 */
export function patchOutdoorLight(m: THREE.MeshStandardMaterial, u: TreeUniforms, key = "outdoor") {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFloodPos;")
      .replace("#include <project_vertex>", `#include <project_vertex>
vec4 floodW = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
floodW = instanceMatrix * floodW;
#endif
vFloodPos = ( modelMatrix * floodW ).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunDirView; uniform vec3 uSun; uniform vec3 uAmbient; uniform vec3 uFlood; uniform vec3 uUpView; uniform float uBowl;\nvarying vec3 vFloodPos;\n" + FLOOD_GLSL)
      .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n" + OUTDOOR_IRRADIANCE);
  };
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}

/** Tree material: outdoor light, and glTF BLEND leaves become alpha-tested (opaque pass, depth write). */
export function patchTreeMaterial(m: THREE.MeshStandardMaterial, u: TreeUniforms) {
  if (m.transparent || m.alphaTest > 0) {
    m.alphaTest = 0.5;
    m.transparent = false;
    m.depthWrite = true;
  }
  patchOutdoorLight(m, u, m.alphaTest > 0 ? "tree-leaf" : "tree");
}
