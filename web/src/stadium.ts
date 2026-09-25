import * as THREE from "three";

const LM_RE = /vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);\s*vec3 lightMapIrradiance = lightMapTexel\.rgb \* lightMapIntensity;/;
const IBL_IRR_RE = /iblIrradiance \+= getIBLIrradiance\( geometryNormal \);/;
const IBL_RAD_RE = /vec3 iblRadiance = getIBLRadiance\( geometryViewDir, geometryNormal, material\.roughness \);/;

/** Decisions D8/D10: blend two RGBM lightmaps, drop diffuse IBL, blend two PMREMs for specular. */
export function patchLightsChunk(chunk: string) {
  for (const re of [LM_RE, IBL_IRR_RE, IBL_RAD_RE]) if (!re.test(chunk)) throw new Error(`three.js lights_fragment_maps changed: ${re}`);
  return chunk
    .replace(LM_RE, `vec3 lightMapIrradiance = mix( rgbmDecode( texture2D( lightMap, vLightMapUv ) ), rgbmDecode( texture2D( uLmB, vLightMapUv ) ), uLmBlend ) * lightMapIntensity;`)
    .replace(IBL_IRR_RE, "")
    .replace(IBL_RAD_RE, `vec3 iblRadiance = mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), getIBLRadianceB( geometryViewDir, geometryNormal, material.roughness ), uEnvBlend );`);
}

const PARS = /* glsl */ `
uniform sampler2D uLmB; uniform float uLmBlend; uniform float uRgbmRange;
uniform sampler2D uEnvB; uniform float uEnvBlend; uniform float uNight;
varying vec3 vWorldPosB;
vec3 rgbmDecode( vec4 c ) { return c.rgb * c.a * uRgbmRange; }
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

/** Decision D7: sail LED points (shell._skin_material): 1.1 m cells, r = 0.055 m, fade 36..50 m, 40 * n. */
export const LED_GLSL = /* glsl */ `
vec3 h33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
float sailLeds( vec3 pB ) {
  vec3 c = floor( pB / 1.1 ), h = h33( c ), q = ( c + h ) * 1.1;
  float dot_ = step( length( pB - q ), 0.055 );
  float fade = mix( 0.55, 1.01, clamp( ( pB.z - 36.0 ) / 14.0, 0.0, 1.0 ) );
  return dot_ * step( fade, h.x ) * ( h.y * 1.5 + 0.3 );
}
`;

export interface SharedUniforms { uLmBlend: { value: number }; uEnvB: { value: THREE.Texture | null }; uEnvBlend: { value: number }; uRgbmRange: { value: number }; uNight: { value: number } }
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

export function setupStadiumMaterials(root: THREE.Object3D, shared: SharedUniforms, useLightmaps: boolean, reversedDepth = false) {
  const byGroup = new Map<string, THREE.MeshStandardMaterial[]>();
  const seen = new Set<THREE.Material>();          // the optimized glb shares materials between meshes
  const chunk = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (seen.has(mat)) return;
    seen.add(mat);
    const group = (o.userData.lightmap ?? o.parent?.userData.lightmap) as string | undefined;
    const ex = mat.userData as { emDay?: number; emNight?: number; special?: string; tint?: number[] };
    if (Array.isArray(ex.tint) && ex.tint.length === 3) mat.color.setRGB(ex.tint[0], ex.tint[1], ex.tint[2]);   // Task 13b (E): linear, may exceed 1
    mat.userData.lmB = { value: null as THREE.Texture | null };
    mat.lightMapIntensity = Math.PI;        // Cycles diffuse bake is E/π; three multiplies by albedo/π
    if (OVERLAY_RE.test(mat.name)) {
      const o = overlayOffset(reversedDepth);
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = o.factor;
      mat.polygonOffsetUnits = o.units;
    }
    if (group) (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(mat);
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, shared, { uLmB: mat.userData.lmB });
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosB;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvec4 wpB = modelMatrix * vec4( transformed, 1.0 ); vWorldPosB = vec3( wpB.x, -wpB.z, wpB.y );");
      s.fragmentShader = s.fragmentShader
        .replace("#include <envmap_physical_pars_fragment>", "#include <envmap_physical_pars_fragment>\n" + PARS + (ex.special === "sailLeds" ? LED_GLSL : ""))
        .replace("#include <lights_fragment_maps>", useLightmaps ? chunk : THREE.ShaderChunk.lights_fragment_maps);
      if (ex.special === "sailLeds")
        s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= sailLeds( vWorldPosB );");
    };
    mat.customProgramCacheKey = () => `stadium-${useLightmaps}-${ex.special ?? ""}`;
    mat.needsUpdate = true;
  });
  return byGroup;
}
