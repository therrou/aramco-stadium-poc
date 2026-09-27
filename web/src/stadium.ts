import * as THREE from "three";
import { MAX_CHARTS, chartUniforms, chartsOfMesh, pitchLinesGlsl, type Chart } from "./pitchLines";
import { STATE_NIGHT } from "./lightingState";
import { SUN_VIS_GLSL } from "./sunShadow";
import { PLANAR_GLSL, isPlanarMaterial } from "./planarReflect";
import { BOARDS, LED_EMISSIVE_GLSL, LED_GLSL_BOARDS, isLedBoard, ledUniforms, ribbonTexture } from "./ledBoards";
import { isScreen, screenTexture } from "./screens";
import { BICUBIC_GLSL, CITY_GLSL, CONCRETE_GLSL, GRASS_GLSL, GROUND_GLSL, GROUND_MAP_GLSL, NET, NET_GLSL, detailFor } from "./detail";

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
export const soMinDefine = (special: string | undefined) =>
  `#define SO_MIN ${(special === "sailLeds" ? SPEC_OCC.sailMin : SPEC_OCC.min).toFixed(3)}\n` + (special === "sailLeds" ? "#define SAIL_SKIN\n" : "");

/**
 * D6 (v3): the sail skin at night. Its night bake is noise around a flat level: up-facing skin texels have a
 * median irradiance of 0.20-0.23 from the oculus rim (s 0) to s 0.8 and 0.23-0.29 at the base, with bright
 * outliers that showed as blocks. At night (blended from golden hour on) the skin takes that smooth level,
 * with the slight rim and base terms, instead of the texels.
 */
export const SAIL_NIGHT_E = 0.21;
const SAIL_NIGHT_GLSL = /* glsl */ `
#ifdef SAIL_SKIN
vec3 sailNightIrradiance( vec3 pB ) {
  float S = pow( pow( abs( pB.x / 138.0 ), 2.25 ) + pow( abs( pB.y / 121.0 ), 2.25 ), 1.0 / 2.25 );
  float O = pow( pow( abs( pB.x / 66.0 ), 2.35 ) + pow( abs( pB.y / 51.0 ), 2.35 ), 1.0 / 2.35 );   // v5 oculus
  float e = S / max( O, 1e-3 ), s = O <= 1.0 ? 0.0 : clamp( ( S - e ) / max( 1.0 - e, 1e-3 ), 0.0, 1.2 );
  float E = ${SAIL_NIGHT_E.toFixed(3)} + 0.03 * ( 1.0 - clamp( s / 0.5, 0.0, 1.0 ) ) + 0.07 * smoothstep( 0.85, 1.0, s );
  return E * vec3( 0.92, 0.96, 1.06 );
}
#endif
`;
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
    .replace(LM_RE, `vec3 lightMapIrradiance = mix( rgbmDecode( texBicubic( lightMap, vLightMapUv ) ), rgbmDecode( texBicubic( uLmB, vLightMapUv ) ), uLmBlend ) * lightMapIntensity;
#ifdef SAIL_SKIN
	lightMapIrradiance = mix( lightMapIrradiance, sailNightIrradiance( vWorldPosB ), smoothstep( 0.6, 1.0, uNight ) );
#endif
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	{   // S1 (v3): outside the shell, sharpen the bake's (blurred) direct sun with the live shadow. The sky share is
		// estimated from the outdoor model's ambient; what the texel has above it is baked direct sun (vb)
		vec3 es = uSun * max( dot( geometryNormal, uSunDirView ), 0.0 );
		float esl = dot( es, vec3( 0.2126, 0.7152, 0.0722 ) ), el = dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
		float sky = min( el, PI * dot( uAmbient, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		float vb = esl > 1e-4 ? clamp( ( el - sky ) / esl, 0.0, 1.0 ) : 0.0;
		// final review 4: only take baked sun away where the live map says shadow; never add sun (baked shadows
		// of casters missing from the map, e.g. impostor trees, and texels outside its frustum must stay)
		lightMapIrradiance = max( lightMapIrradiance - es * vb * ( 1.0 - sunVisibility() ) * outsideShell( vWorldPosB ) * sunInShadowMap(), vec3( 0.0 ) );
	}
#endif`)
    .replace(IBL_IRR_RE, "")
    .replace(IBL_RAD_RE, `#ifdef USE_LIGHTMAP
		float lmSo = lmSpecOcc( lightMapIrradiance );
	#else
		float lmSo = 1.0;
	#endif
	vec3 iblRadiance = mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), getIBLRadianceB( geometryViewDir, geometryNormal, material.roughness ), uEnvBlend ) * lmSo;
#ifdef PLANAR_REFLECT
	iblRadiance = mix( iblRadiance, planarReflection( material.roughness ) * slabMask( diffuseColor.rgb ), uReflectOn );
#endif`)
    .replace(COAT_RAD_RE, `clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), getIBLRadianceB( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), uEnvBlend ) * lmSo;`);
}

export const PARS = /* glsl */ `
uniform sampler2D uLmB; uniform float uLmBlend; uniform float uRgbmRange; uniform float uLmGamma;
uniform sampler2D uEnvB; uniform float uEnvBlend; uniform float uNight;
varying vec3 vWorldPosB;
// v4: lightmaps ship as gamma RGB (manifest lmGamma, webexport/rgbm.py); RGBM when uLmGamma is 0 (older assets)
vec3 rgbmDecode( vec4 c ) { return uLmGamma > 0.0 ? pow( max( c.rgb, vec3( 0.0 ) ), vec3( uLmGamma ) ) * uRgbmRange : c.rgb * c.a * uRgbmRange; }
uniform vec3 uSun; uniform vec3 uSunDirView; uniform vec3 uAmbient;   // S1: the sun and sky as in treeLight
${BICUBIC_GLSL}
${PLANAR_GLSL}
${SAIL_NIGHT_GLSL}
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

/**
 * v4: the sail skin is translucent in Cycles (shell._add_translucency: 0.35 x (1 - n)) over an underside that
 * glows (v4 teal-mint, v5 lime green) (shell._under_material: (3.5 (1 - h)^1.6 + 1) x n, h the height 9..45 m), so at golden hour
 * the lobes read mint from outside. The web skin is opaque: that transmitted glow is added as emission.
 * k scales it against the Cycles pairs (renders/web_v4).
 */
export const SAIL_GLOW = { k: 1.5, translucency: 0.35, color: [0.62, 1.0, 0.35] } as const;   // v5: lime (HD key visual)
export const sailGlow = (z: number, n: number) => {
  const h = Math.min(Math.max((z - 9) / 36, 0), 1);
  return SAIL_GLOW.k * SAIL_GLOW.translucency * (1 - n) * n * (3.5 * (1 - h) ** 1.6 + 1);
};
export const SAIL_GLOW_GLSL = /* glsl */ `
vec3 sailGlow( vec3 pB ) {
  float h = clamp( ( pB.z - 9.0 ) / 36.0, 0.0, 1.0 );
  float g = ${SAIL_GLOW.k.toFixed(3)} * ${SAIL_GLOW.translucency.toFixed(3)} * ( 1.0 - uNight ) * uNight * ( 3.5 * pow( 1.0 - h, 1.6 ) + 1.0 );
  return g * vec3( ${SAIL_GLOW.color.map((v) => v.toFixed(2)).join(", ")} );
}
`;

export interface SharedUniforms {
  /** S1: the sun (irradiance and view-space direction), shared with the outdoor model; set by main.ts. */
  uSun?: { value: THREE.Color }; uSunDirView?: { value: THREE.Vector3 }; uAmbient?: { value: THREE.Color };
  /** v3 option 2: the plaza's mirror image (planarReflect.ts); set by main.ts. */
  tReflect?: { value: THREE.Texture }; uReflectMatrix?: { value: THREE.Matrix4 }; uReflectOn?: { value: number };
  uLmBlend: { value: number }; uEnvB: { value: THREE.Texture | null }; uEnvBlend: { value: number }; uRgbmRange: { value: number }; uLmGamma: { value: number }; uNight: { value: number }; uSoK: { value: number } }
/** Full uniform set seen by a stadium material: the shared ones plus its own second lightmap. */
export interface LightingUniforms extends SharedUniforms { uLmB: { value: THREE.Texture | null } }

/**
 * Flat decals that sit on another surface by design (Task 13b, A): road lines lie exactly on the asphalt
 * (both z = 0.02), glow strips 5 mm above it, pitch lines 1 cm above the grass, podium strips on the deck.
 */
/**
 * v4: the optimized glb stores positions as 16-bit over the 2.6 km site (~4 cm steps), so the fan-zone paving
 * (Blender z 0.012) landed 7 mm under the lawn it sits on (z -0.02) and the lawn, baked black beneath it, showed
 * through from above. Paving meshes are lifted a few centimetres (invisible; the deck top moves too). Not M_Plaza:
 * it is one disc centred on the stadium, hidden under the pitch (-1 cm), and lifting it covered the grass.
 */
export const PAVING_LIFT_RE = /^M_Paving\b/;
export const PAVING_LIFT_M = 0.05;
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
/** v4 team dugouts: canopy glass (pitch.py _dugouts). */
export const DUGOUT_GLASS_RE = /^M_DugoutGlass\b/;
export const DUGOUT_GLASS = { opacity: 0.4, env: 1.0, lmBoost: 3.0, milk: [0.72, 0.78, 0.8] as [number, number, number], emDay: 0.45, emNight: 0.06 } as const;
/**
 * v4 (user: the sign glowed unevenly at night): the letters' faces fall into three lightmap groups by position
 * and height (site, site_near, site_mid), baked at different densities, and their own 14x night emission was
 * baked into those maps and bloomed. The sign lights itself evenly instead: the baked light is mostly ignored
 * and a moderate, uniform emission carries it (day keeps a little so the white reads under the sun).
 */
export const SIGN_RE = /^M_SignWhite\b/;
export const SIGN = { lm: 0.25, emDay: 0.55, emNight: 2.4 } as const;
/** v4: city blocks (site.py _city, lit windows). */
export const CITY_RE = /^M_Building\d/;
/** v4 LED ribbons on the tier fronts (signage.py). */
export const RIBBON_RE = /^M_FasciaLED\b/;
export const FLOOD_LENS_RE = /^M_FloodLens\b/;
export const FLOOD_LENS_MAX = 30;

/** Spec v3 part 2: the detail shaders (detail.ts) and what each does after the albedo map. */
const FLAT_NORMAL_B = "vec3 nB = normalize( cross( dFdx( vWorldPosB ), dFdy( vWorldPosB ) ) );\n";
const DETAIL_GLSL = { grass: GRASS_GLSL, net: NET_GLSL, concrete: CONCRETE_GLSL, ground: GROUND_GLSL, slab: GROUND_GLSL, city: CITY_GLSL } as const;
/** Light added after the lightmap (D5: the podium's night glow on the plaza). */
const PODIUM_LIGHT = "irradiance += podiumGlow( vWorldPosB ) * uNight;";
const DETAIL_LIGHT: Partial<Record<keyof typeof DETAIL_GLSL, string>> = { ground: PODIUM_LIGHT, slab: PODIUM_LIGHT };
const DETAIL_MAP = {
  grass: "diffuseColor.rgb = grassAlbedo( vWorldPosB );",
  net: FLAT_NORMAL_B + `diffuseColor.rgb = vec3( ${NET.color.toFixed(2)} ); diffuseColor.a = netCoverage( netPlane( vWorldPosB, nB ) );`,
  concrete: FLAT_NORMAL_B + "diffuseColor.rgb *= concreteDetail( vWorldPosB, nB );",
  ground: GROUND_MAP_GLSL + "diffuseColor.rgb *= groundDetail( vWorldPosB );",
  slab: "diffuseColor.rgb *= mix( vec3( 1.0 ), groundDetail( vWorldPosB ), 0.5 );",
  city: FLAT_NORMAL_B + "diffuseColor.rgb *= cityFacade( vWorldPosB, nB );",
} as const;

/** The lights chunk a stadium material compiles: patched or stock, the pitch lines' UVs, then any detail light. */
export function lightsChunkFor(chunk: string, useLightmaps: boolean, lines: boolean, detail: keyof typeof DETAIL_GLSL | undefined) {
  const base = useLightmaps ? (lines ? pitchLinesChunk(chunk) : chunk) : THREE.ShaderChunk.lights_fragment_maps;
  return base + (detail && DETAIL_LIGHT[detail] ? "\n" + DETAIL_LIGHT[detail] : "");
}

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

/** v3: anisotropic filtering for the surface textures, capped at 8 (grazing ground showed moire stripes at 1). */
export const MAX_ANISO = 8;

export function setupStadiumMaterials(root: THREE.Object3D, shared: SharedUniforms, useLightmaps: boolean, reversedDepth = false, maxAniso = 1) {
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
  root.traverse((o) => {                           // v4: paving over lawn survives the position quantization
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && PAVING_LIFT_RE.test((mesh.material as THREE.Material).name)) mesh.position.y += PAVING_LIFT_M;
  });
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (seen.has(mat)) return;
    seen.add(mat);
    const group = groupOf(o);
    const lines = useLightmaps && lineCharts !== null && group === "pitch" && PITCH_LINES_RE.test(mat.name);
    const ex = mat.userData as { emDay?: number; emNight?: number; special?: string; tint?: number[]; emLate?: boolean };
    const detail = detailFor(mat.name);
    const planar = useLightmaps && isPlanarMaterial(mat.name);
    const led = isLedBoard(mat.name);
    if (led) {                                        // pitch LED ad boards (ledBoards.ts): black panels lit by the ad
      ex.emDay = BOARDS.emDay; ex.emNight = BOARDS.emNight;
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveMap = null;                       // v4: the glb carries Blender's board image; the web draws its own ads
      mat.color.setRGB(0.012, 0.012, 0.014);
      mat.roughness = 0.6;
      mat.envMapIntensity = 0.12;                   // the sky's sheen on the glossy face washed the ad out
    }
    if (isScreen(mat.name)) {                        // v4: looping feed (screens.ts) on a matte LED face
      if (screenTexture.value) mat.emissiveMap = screenTexture.value;
      mat.roughness = 0.7;
      mat.envMapIntensity = 0.1;                    // the glossy face mirrored the golden sky over the picture
    }
    if (SIGN_RE.test(mat.name)) { ex.emDay = SIGN.emDay; ex.emNight = SIGN.emNight; mat.emissive.setRGB(1, 1, 1); }
    if (CITY_RE.test(mat.name)) ex.emLate = true;          // v4: city windows light up only toward night
    if (RIBBON_RE.test(mat.name) && ribbonTexture.value) mat.emissiveMap = ribbonTexture.value;   // v4: sponsor ads, not the placeholder
    if (DUGOUT_GLASS_RE.test(mat.name)) {            // v4: the canopy sheet faces down, so its bake is the shaded underside
      mat.opacity = DUGOUT_GLASS.opacity;           // (dark); Cycles shows clear glass lit by the sky: thin it, mirror the sky
      mat.roughness = 0.05;
      mat.metalness = 0;
      mat.envMapIntensity = DUGOUT_GLASS.env;
      mat.emissive.setRGB(...DUGOUT_GLASS.milk);   // milky polycarbonate: it scatters daylight, so it reads light from above
      ex.emDay = DUGOUT_GLASS.emDay; ex.emNight = DUGOUT_GLASS.emNight;
    }
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap]) if (t) t.anisotropy = Math.min(MAX_ANISO, maxAniso);
    if (detail === "grass") mat.map = null;           // D1: the shader draws the grass; the 1024 px bake is not needed
    if (detail === "net") { mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.alphaTest = 0; }
    if (Array.isArray(ex.tint) && ex.tint.length === 3) mat.color.setRGB(ex.tint[0], ex.tint[1], ex.tint[2]);   // Task 13b (E): linear, may exceed 1
    if (FLOOD_LENS_RE.test(mat.name)) {
      if (typeof ex.emNight === "number") ex.emNight = Math.min(ex.emNight, FLOOD_LENS_MAX);
      mat.side = THREE.FrontSide;
    }
    mat.userData.lmB = { value: null as THREE.Texture | null };
    mat.lightMapIntensity = Math.PI * (DUGOUT_GLASS_RE.test(mat.name) ? DUGOUT_GLASS.lmBoost : SIGN_RE.test(mat.name) ? SIGN.lm : 1);   // Cycles diffuse bake is E/π; three multiplies by albedo/π
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
      Object.assign(s.uniforms, shared, { uLmB: mat.userData.lmB }, lines ? chartUniforms(lineCharts!) : {}, led ? ledUniforms : {});
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosB;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvec4 wpB = modelMatrix * vec4( transformed, 1.0 ); vWorldPosB = vec3( wpB.x, -wpB.z, wpB.y );");
      s.fragmentShader = s.fragmentShader
        .replace("#include <shadowmap_pars_fragment>", "#include <shadowmap_pars_fragment>\n" + SUN_VIS_GLSL)
        .replace("#include <envmap_physical_pars_fragment>", "#include <envmap_physical_pars_fragment>\n" + soMinDefine(ex.special) + (planar ? "#define PLANAR_REFLECT\n" : "") + PARS + (led ? LED_GLSL_BOARDS : "") + (ex.special === "sailLeds" ? LED_GLSL + SAIL_GLOW_GLSL : "")
          + (lines ? pitchLinesGlsl(lineCharts!.length) : ""))
        .replace("#include <lights_fragment_maps>", lightsChunkFor(chunk, useLightmaps, lines, detail));
      if (detail) s.fragmentShader = s.fragmentShader
        .replace("#include <envmap_physical_pars_fragment>", "#include <envmap_physical_pars_fragment>\n" + DETAIL_GLSL[detail])
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + DETAIL_MAP[detail])
      if (detail === "city") s.fragmentShader = s.fragmentShader     // v4: night window light only inside the windows
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ " + FLAT_NORMAL_B + "totalEmissiveRadiance *= 0.3 + 2.2 * cityWindow( vWorldPosB, nB ); }");
      if (led) s.fragmentShader = s.fragmentShader
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + LED_EMISSIVE_GLSL);
      if (ex.special === "sailLeds")
        s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance = min( totalEmissiveRadiance * sailLeds( vWorldPosB ), vec3( " + LED_MAX.toFixed(2) + " ) ) + sailGlow( vWorldPosB );");
    };
    mat.customProgramCacheKey = () => `stadium-${useLightmaps}-${ex.special ?? ""}${lines ? `-lines${lineCharts!.length}` : ""}-${detail ?? ""}${planar ? "-planar" : ""}${led ? "-led" : ""}`;
    mat.needsUpdate = true;
  });
  return byGroup;
}
