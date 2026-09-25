import * as THREE from "three";
import { MAX_CHARTS, chartUniforms, chartsOfMesh, pitchLinesGlsl, type Chart } from "./pitchLines";
import { STATE_NIGHT } from "./lightingState";

const LM_RE = /vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);\s*vec3 lightMapIrradiance = lightMapTexel\.rgb \* lightMapIntensity;/;
const IBL_IRR_RE = /iblIrradiance \+= getIBLIrradiance\( geometryNormal \);/;
const IBL_RAD_RE = /vec3 iblRadiance = getIBLRadiance\( geometryViewDir, geometryNormal, material\.roughness \);/;
const COAT_RAD_RE = /clearcoatRadiance \+= getIBLRadiance\( geometryViewDir, geometryClearcoatNormal, material\.clearcoatRoughness \);/;

/**
 * A1 (v2): specular occlusion from the baked light. The PMREM sky reaches every surface, so the sail skin
 * (metal 0.9 + coat), concourse glass and grass mirrored a bright sky even in shade: the main cause of
 * the washed-out day look. so = clamp( luminance( lightmap irradiance ) / K, min, 1 ). Irradiance is in
 * the bake's units (W/m^2, decoded RGBM x PI): day sunlit ground ~3, golden ~1.5, night floods ~1.1 in
 * the bowl. K is the irradiance at which a surface gets its full reflection. Tuned in Task 8.
 */
export const SPEC_OCC = { k: { day: 2.0, golden: 1.0, night: 0.5 }, min: 0.1, sailMin: 0.5 };
/**
 * Occlusion floor per material: the sail skin's night lightmap is coarse (1024 px over ~40k m^2) and noisy,
 * and full occlusion printed its texel blocks onto the reflections. Sunlit sails sit above K by day anyway.
 */
export const soMinDefine = (special: string | undefined) => `#define SO_MIN ${(special === "sailLeds" ? SPEC_OCC.sailMin : SPEC_OCC.min).toFixed(3)}`;
export function specOccK(n: number) {
  const g = STATE_NIGHT.golden;
  return n <= g ? SPEC_OCC.k.day + (SPEC_OCC.k.golden - SPEC_OCC.k.day) * (n / g)
                : SPEC_OCC.k.golden + (SPEC_OCC.k.night - SPEC_OCC.k.golden) * ((n - g) / (1 - g));
}

/**
 * Decisions D8/D10: blend two RGBM lightmaps, drop diffuse IBL, blend two PMREMs for specular. The clear
 * coat IBL (sail skin) is blended the same way (final review 1a): envMap alone is the "from" PMREM.
 */
export function patchLightsChunk(chunk: string) {
  for (const re of [LM_RE, IBL_IRR_RE, IBL_RAD_RE, COAT_RAD_RE]) if (!re.test(chunk)) throw new Error(`three.js lights_fragment_maps changed: ${re}`);
  return chunk
    .replace(LM_RE, `vec3 lightMapIrradiance = mix( rgbmDecode( texture2D( lightMap, vLightMapUv ) ), rgbmDecode( texture2D( uLmB, vLightMapUv ) ), uLmBlend ) * lightMapIntensity;`)
    .replace(IBL_IRR_RE, "")
    .replace(IBL_RAD_RE, `#ifdef USE_LIGHTMAP
		float lmSo = lmSpecOcc( lightMapIrradiance );
	#else
		float lmSo = 1.0;
	#endif
	vec3 iblRadiance = mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), getIBLRadianceB( geometryViewDir, geometryNormal, material.roughness ), uEnvBlend ) * lmSo;`)
    .replace(COAT_RAD_RE, `clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), getIBLRadianceB( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), uEnvBlend ) * lmSo;`);
}

const PARS = /* glsl */ `
uniform sampler2D uLmB; uniform float uLmBlend; uniform float uRgbmRange;
uniform sampler2D uEnvB; uniform float uEnvBlend; uniform float uNight;
varying vec3 vWorldPosB;
vec3 rgbmDecode( vec4 c ) { return c.rgb * c.a * uRgbmRange; }
uniform float uSoK;
float lmSpecOcc( vec3 e ) { return clamp( dot( e, vec3( 0.2126, 0.7152, 0.0722 ) ) / uSoK, SO_MIN, 1.0 ); }
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
vec3 getIBLRadianceB( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
  vec3 r = normalize( mix( reflect( - viewDir, normal ), normal, pow4( roughness ) ) );
  r = transformDirectionByInverseViewMatrix( r, viewMatrix );
  return textureCubeUV( uEnvB, envMapRotation * r, roughness ).rgb * envMapIntensity;
}
#else
vec3 getIBLRadianceB( const in vec3 v, const in vec3 n, const in float r ) { return vec3( 0.0 ); }
#endif
`;

/**
 * A3 (v2): LED lattice. Blender (shell._skin_material) draws one dot of radius 0.05 cell per 1.1 m cell of a
 * 2D Voronoi in the skin's metre UVs: 1/1.1^2 dots per m^2 covering pi 0.055^2 / 1.1^2 of the skin. The glb's
 * UVs are quantised, so the web hashes 3D cells instead; a plane crosses spheres of radius r in cells c at
 * 2r / c^3 dots per m^2 covering (4/3) pi r^3 / c^3. Solving both for the Cycles values gives r = 0.055
 * sqrt(1.5) and c below. (v1 used c = 1.1, r = 0.055 in 3D: 15x too sparse next to the Cycles renders.)
 */
const CYCLES_LED_DENSITY = 1 / 1.1 ** 2, CYCLES_LED_COVER = Math.PI * 0.055 ** 2 / 1.1 ** 2;
export const LED_R = Math.sqrt((3 * CYCLES_LED_COVER) / (2 * Math.PI * CYCLES_LED_DENSITY));
export const LED_CELL = Math.cbrt((2 * LED_R) / CYCLES_LED_DENSITY);
/** Mean share of a surface covered by the LED dots. */
export const LED_COVER = (4 / 3) * Math.PI * LED_R ** 3 / LED_CELL ** 3;
/** A3 (v2): LED radiance clamp, below BLOOM.threshold (lighting.ts), so no LED blooms on its own. */
export const LED_MAX = 15.0;

/**
 * Decision D7: sail LED points (shell._skin_material): cells and radius above, fade 36..50 m, 40 * n.
 * A3 (v2): the dots are far below a pixel from most views, so a hard step hit or missed each dot
 * per frame and each hit bloomed ("lights re-render" when the camera moved). The dot now grows to the
 * pixel footprint with its radiance scaled to keep its energy ((r0/r)^3, the plane's mean cut through a
 * sphere), edges are smoothstepped over one pixel, and once a pixel spans about a cell it fades to the
 * cells' mean radiance: LED_COVER x lit share (1 - fade) x mean brightness 1.05.
 */
export const LED_GLSL = /* glsl */ `
vec3 h33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
float sailLeds( vec3 pB ) {
  vec3 c = floor( pB / ${LED_CELL.toFixed(4)} ), h = h33( c ), q = ( c + h ) * ${LED_CELL.toFixed(4)};
  float fade = mix( 0.55, 1.01, clamp( ( pB.z - 36.0 ) / 14.0, 0.0, 1.0 ) );
  float lit = step( fade, h.x ) * ( h.y * 1.5 + 0.3 );
  float px = max( length( fwidth( pB ) ), 1e-5 );
  float r = max( ${LED_R.toFixed(4)}, px );
  float k = ${LED_R.toFixed(4)} / r;
  float dot_ = ( 1.0 - smoothstep( r - 0.5 * px, r + 0.5 * px, length( pB - q ) ) ) * k * k * k;
  float avg = ${LED_COVER.toExponential(4)} * max( 1.0 - fade, 0.0 ) * 1.05;
  return mix( dot_ * lit, avg, smoothstep( 0.3, 0.9, px / ${LED_CELL.toFixed(4)} ) );
}
`;

export interface SharedUniforms { uLmBlend: { value: number }; uEnvB: { value: THREE.Texture | null }; uEnvBlend: { value: number }; uRgbmRange: { value: number }; uNight: { value: number }; uSoK: { value: number } }
/** Full uniform set seen by a stadium material: the shared ones plus its own second lightmap. */
export interface LightingUniforms extends SharedUniforms { uLmB: { value: THREE.Texture | null } }

/**
 * Flat decals that sit on another surface by design (Task 13b, A): road lines lie exactly on the asphalt
 * (both z = 0.02), glow strips 5 mm above it, pitch lines 1 cm above the grass, podium strips on the deck.
 */
export const OVERLAY_RE = /^M_(RoadLine|StreetGlow|PodiumStrip|LineWhite)\b/;
/**
 * polygonOffset pulling overlays toward the camera. three negates `factor` for a reversed depth buffer
 * but passes `units` through, so units' sign is set here.
 */
export function overlayOffset(reversedDepth: boolean) {
  return { factor: -1, units: reversedDepth ? 4 : -4 };
}

/**
 * Fix round 1 (grazing specular): the PMREM has a bright horizon (day ~3.6) and a black lower hemisphere,
 * so flat ground seen at a low angle mirrors the horizon sky over its whole extent: lawn and desert read
 * blue-grey where Cycles reflects the scene around them. A/B at CAM_Aerial_SW: envMapIntensity 0 on
 * these materials turned the lawn olive/tan like renders/aerial_sw_day.png. They keep a little sheen.
 */
export const GROUND_RE = /^M_(Sand|Lawn|Asphalt|Paving|Plaza)\b/;
export const GROUND_ENV = 0.3;
/**
 * A2 (v2): sky reflection strength per material, first match wins (envMapIntensity scales the PMREM
 * sample and the clear coat alike). Glass mirrored the ~3.6 horizon (podium mean 202 web vs 97 Cycles),
 * grass had full sky sheen. Tuned in Task 8.
 */
export const ENV_INTENSITY: [RegExp, number][] = [
  [GROUND_RE, GROUND_ENV],
  [/^M_(ConcourseGlass|SuiteGlass)\b/, 0.3],
  [/^M_Grass\b/, 0.2],
  [/^M_Steel\b/, 0.5],
];
export const envIntensityOf = (name: string) => ENV_INTENSITY.find(([re]) => re.test(name))?.[1];

export const SAIL_RE = /^M_SailSkin\b/;
/** A5 (v2): sail skin reflection at night (Cycles shows dark skin with LEDs, the web mirrored the dusk sky). Tuned in Task 8. */
export const SAIL_NIGHT_ENV = 1.0;
export const sailEnvIntensity = (n: number) => 1 + (SAIL_NIGHT_ENV - 1) * n;
/** M_SailSkin: pearl metal with a clear coat (Blender coat 0.35, coat roughness 0.08). */
export const SAIL_COAT = { clearcoat: 0.35, clearcoatRoughness: 0.08 };

/** glTF gives MeshStandardMaterial (the export writes no coat): swap the sail skin for a physical copy. */
export function toCoatedSail(m: THREE.MeshStandardMaterial) {
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.defines = { STANDARD: "", PHYSICAL: "" };             // Standard.copy resets defines
  p.clearcoat = SAIL_COAT.clearcoat;
  p.clearcoatRoughness = SAIL_COAT.clearcoatRoughness;
  return p;
}

/**
 * A4 (v2): M_FloodLens emits 120 at night (glb emNight) against a bloom threshold of 12, and double-sided
 * lenses showed their backs too: a ring of halos (9 % of the roof-glow area clipped vs 3 % in Cycles).
 * The viewer caps the lens and draws its front only. Tuned in Task 8.
 */
export const FLOOD_LENS_RE = /^M_FloodLens\b/;
export const FLOOD_LENS_MAX = 30;

/** Final review 4: flat pitch lines take their lightmap UV from the grass charts (see pitchLines.ts). */
export const PITCH_LINES_RE = /^M_LineWhite\b/;
export const PITCH_GRASS_RE = /^M_Grass\b/;
/** The lines' lightmap lookup: every vLightMapUv of the (patched) chunk goes through pitchLmUv. */
export const pitchLinesChunk = (chunk: string) => chunk.replaceAll("vLightMapUv", "pitchLmUv( vWorldPosB, vLightMapUv )");

export const groupOf = (o: THREE.Object3D) => (o.userData.lightmap ?? o.parent?.userData.lightmap) as string | undefined;

/** Gives every (material, lightmap group) pair its own material; returns the number of copies made. */
export function splitByGroup(root: THREE.Object3D) {
  const owner = new Map<THREE.Material, string | undefined>();
  const copies = new Map<string, THREE.Material>();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.Material, g = groupOf(o);
    if (!owner.has(m)) { owner.set(m, g); return; }
    if (owner.get(m) === g) return;
    const key = `${m.uuid}:${g}`;
    if (!copies.has(key)) { copies.set(key, m.clone()); n++; }
    mesh.material = copies.get(key)!;
  });
  return n;
}

export function setupStadiumMaterials(root: THREE.Object3D, shared: SharedUniforms, useLightmaps: boolean, reversedDepth = false) {
  const coated = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.isMesh ? (mesh.material as THREE.MeshStandardMaterial) : null;
    if (!m || !SAIL_RE.test(m.name) || (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return;
    if (!coated.has(m)) coated.set(m, toCoatedSail(m));
    mesh.material = coated.get(m)!;
  });
  // A material shared by meshes of two lightmap groups (site__M_Lawn and site_near__M_Lawn share
  // M_Lawn.web) must not be: each group binds its own atlas to material.lightMap. One copy per group.
  splitByGroup(root);
  const byGroup = new Map<string, THREE.MeshStandardMaterial[]>();
  const seen = new Set<THREE.Material>();          // the optimized glb shares materials between meshes
  const chunk = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  let grassCharts: Chart[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && groupOf(o) === "pitch" && PITCH_GRASS_RE.test((mesh.material as THREE.Material).name)) grassCharts = chartsOfMesh(mesh);
  });
  const lineCharts = grassCharts.length > 0 && grassCharts.length <= MAX_CHARTS ? grassCharts : null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (seen.has(mat)) return;
    seen.add(mat);
    const group = groupOf(o);
    const lines = useLightmaps && lineCharts !== null && group === "pitch" && PITCH_LINES_RE.test(mat.name);
    const ex = mat.userData as { emDay?: number; emNight?: number; special?: string; tint?: number[] };
    if (Array.isArray(ex.tint) && ex.tint.length === 3) mat.color.setRGB(ex.tint[0], ex.tint[1], ex.tint[2]);   // Task 13b (E): linear, may exceed 1
    if (FLOOD_LENS_RE.test(mat.name)) {
      if (typeof ex.emNight === "number") ex.emNight = Math.min(ex.emNight, FLOOD_LENS_MAX);
      mat.side = THREE.FrontSide;
    }
    mat.userData.lmB = { value: null as THREE.Texture | null };
    mat.lightMapIntensity = Math.PI;        // Cycles diffuse bake is E/π; three multiplies by albedo/π
    const env = envIntensityOf(mat.name);
    if (env !== undefined) mat.envMapIntensity = env;
    if (OVERLAY_RE.test(mat.name)) {
      const o = overlayOffset(reversedDepth);
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = o.factor;
      mat.polygonOffsetUnits = o.units;
    }
    if (group) (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(mat);
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, shared, { uLmB: mat.userData.lmB }, lines ? chartUniforms(lineCharts!) : {});
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosB;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvec4 wpB = modelMatrix * vec4( transformed, 1.0 ); vWorldPosB = vec3( wpB.x, -wpB.z, wpB.y );");
      s.fragmentShader = s.fragmentShader
        .replace("#include <envmap_physical_pars_fragment>", "#include <envmap_physical_pars_fragment>\n" + soMinDefine(ex.special) + PARS + (ex.special === "sailLeds" ? LED_GLSL : "")
          + (lines ? pitchLinesGlsl(lineCharts!.length) : ""))
        .replace("#include <lights_fragment_maps>", useLightmaps ? (lines ? pitchLinesChunk(chunk) : chunk) : THREE.ShaderChunk.lights_fragment_maps);
      if (ex.special === "sailLeds")
        s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance = min( totalEmissiveRadiance * sailLeds( vWorldPosB ), vec3( " + LED_MAX.toFixed(2) + " ) );");
    };
    mat.customProgramCacheKey = () => `stadium-${useLightmaps}-${ex.special ?? ""}${lines ? `-lines${lineCharts!.length}` : ""}`;
    mat.needsUpdate = true;
  });
  return byGroup;
}
