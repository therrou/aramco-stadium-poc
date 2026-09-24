import * as THREE from "three";
import { toThree } from "./coords";
import { sunColor, sunStrength, sunToward, STATE_NIGHT } from "./lightingState";

/**
 * Outdoor light for everything that is not lightmapped (trees, seats, section patches): Blender's sun
 * (same formulas as lighting.py) plus a per-state ambient. With lightmaps there are no scene lights,
 * so without this those meshes render black (controller ruling R11).
 */
export interface TreeUniforms { uSunDirView: { value: THREE.Vector3 }; uSun: { value: THREE.Color }; uAmbient: { value: THREE.Color } }
export type OutdoorUniforms = TreeUniforms;
export const TREE_AMBIENT = { day: 0.9, golden: 0.55, night: 0.12 };
export const makeTreeUniforms = (): TreeUniforms => ({ uSunDirView: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() } });

/** Trees aren't lightmapped: Blender's sun (same formulas) + a per-state ambient. `camera.matrixWorldInverse` must be current. */
export function updateTreeUniforms(u: TreeUniforms, n: number, camera: THREE.Camera) {
  u.uSunDirView.value.copy(toThree(sunToward(n))).transformDirection(camera.matrixWorldInverse);
  u.uSun.value.setRGB(...sunColor(n)).multiplyScalar(sunStrength(n));
  const g = STATE_NIGHT.golden;
  const amb = n <= g ? THREE.MathUtils.lerp(TREE_AMBIENT.day, TREE_AMBIENT.golden, n / g)
                     : THREE.MathUtils.lerp(TREE_AMBIENT.golden, TREE_AMBIENT.night, (n - g) / (1 - g));
  u.uAmbient.value.setRGB(amb * 0.8, amb * 0.87, amb);
}

/** Leaves the uniforms at zero: used when the fallback scene lights are on (no lightmaps), so nothing is lit twice. */
export function clearTreeUniforms(u: TreeUniforms) {
  u.uSun.value.setRGB(0, 0, 0);
  u.uAmbient.value.setRGB(0, 0, 0);
}

/**
 * Irradiance added in lights_fragment_maps; RE_IndirectDiffuse multiplies by albedo / PI. The sun strength is
 * Blender's irradiance (W/m^2), as in the lightmaps (stored E/PI, scaled by lightMapIntensity = PI), so it is
 * added as-is: radiance = albedo * sun * N.L / PI, matching the baked surfaces. uAmbient is a sky radiance
 * over the hemisphere, hence PI * uAmbient. (The brief had PI * (ambient + sun): ~3x too bright next to the bake.)
 */
export const OUTDOOR_IRRADIANCE = "irradiance += PI * uAmbient + uSun * max( dot( geometryNormal, uSunDirView ), 0.0 );";

/**
 * Adds the outdoor sun + ambient to a MeshStandardMaterial. Composes with an existing onBeforeCompile
 * (e.g. SectionPatches' slot hiding) instead of replacing it. No alpha changes here.
 */
export function patchOutdoorLight(m: THREE.MeshStandardMaterial, u: TreeUniforms, key = "outdoor") {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunDirView; uniform vec3 uSun; uniform vec3 uAmbient;")
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
