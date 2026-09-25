import * as THREE from "three";
import { toThree } from "./coords";
import { sunToward } from "./lightingState";

/**
 * Spec v3 part 3 (S1): real-time sun shadows. The sun's light is already in the lightmaps; what they miss is a
 * sharp edge (texels of 0.5-6.5 m). One directional light with intensity 0 casts a shadow map over the stadium
 * and its plaza (4096^2 over +-340 m: ~17 cm per texel); materials read its visibility to cut the direct sun out
 * of the lightmap where the map says shadow (stadium.ts) and to shade the trees and exterior (treeLight.ts).
 * S2 ruling: only outside the shell. Inside, the roof blocks the direct beam at the day and golden sun angles;
 * the bowl's light is sky and the sails' diffuse translucency, which the bake has right and which the
 * sharpening misread as direct sun (the pitch went 35 % darker than Cycles).
 * The scene is static, so the map is rendered only when the sun moves (lighting transitions), not per frame.
 */
export const SHADOW = { mapSize: 4096, radius: 340, distance: 800, bias: -0.0004, normalBias: 0.1, blur: 2 } as const;
/** Stadium centre the shadow frustum is fitted around (Blender coords, mid-height of the bowl). */
const CENTRE: [number, number, number] = [0, 0, 20];

export class SunShadow {
  readonly light = new THREE.DirectionalLight(0xffffff, 0);
  private lastN = NaN;
  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const l = this.light, cam = l.shadow.camera;
    l.castShadow = true;
    l.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
    l.shadow.bias = SHADOW.bias;
    l.shadow.normalBias = SHADOW.normalBias;
    l.shadow.radius = SHADOW.blur;
    cam.left = cam.bottom = -SHADOW.radius;
    cam.right = cam.top = SHADOW.radius;
    cam.near = 1;
    cam.far = SHADOW.distance * 2;
    cam.updateProjectionMatrix();
    l.target.position.copy(toThree(CENTRE));
    scene.add(l, l.target);
  }
  /** Points the sun for night value n; asks for one shadow-map render when it moved. */
  update(n: number) {
    if (n === this.lastN) return;
    this.lastN = n;
    const d = toThree(sunToward(n)).normalize();
    this.light.position.copy(toThree(CENTRE)).addScaledVector(d, SHADOW.distance);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }
}

/**
 * GLSL (after shadowmap_pars_fragment): the sun's visibility from the shadow map, 1 where there is no map or
 * outside its frustum, and whether this fragment is inside the frustum (so callers can fall back).
 */
export const SUN_VIS_GLSL = /* glsl */ `
float sunVisibility() {
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow s0 = directionalLightShadows[ 0 ];
  return getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowIntensity, s0.shadowBias, s0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
#else
  return 1.0;
#endif
}
// 0 inside the shell's plan outline (params.SHELL_A/B/N), 1 from 5 % outside it (Blender coords)
float outsideShell( vec3 pB ) {
  float S = pow( pow( abs( pB.x / 138.0 ), 2.25 ) + pow( abs( pB.y / 121.0 ), 2.25 ), 1.0 / 2.25 );
  return smoothstep( 1.0, 1.05, S );
}
float sunInShadowMap() {
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vec3 c = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
  return all( greaterThanEqual( c, vec3( 0.02 ) ) ) && all( lessThanEqual( c, vec3( 0.98 ) ) ) ? 1.0 : 0.0;
#else
  return 0.0;
#endif
}
`;
