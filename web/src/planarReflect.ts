import * as THREE from "three";
import type { V3 } from "./coords";
import { isInside } from "./route";

/**
 * v3 option 2: planar reflection for the plaza. In Cycles the glossy paving mirrors the lit facade (the biggest
 * remaining gap: CAM_Approach night at 0.62 of Cycles); the web reflected only the sky PMREM. The scene is
 * rendered once more from the camera mirrored about the ground plane (half resolution, no MSAA, a global
 * clipping plane at the ground; three's Reflector edits the projection for an oblique near plane, which breaks
 * with the reversed depth buffer and clipped the whole stadium away), and the paving/plaza materials use that
 * image in place of their sky reflection, so their own
 * roughness and Fresnel still apply (stadium.ts, PLANAR_REFLECT). Only when the plaza can be seen close.
 */
/**
 * Blur: the mirror image is mip-mapped and read at a level set by the roughness (floored at minRough: the tiles
 * are glossy, not polished), plus a vertical smear of `smear` uv per unit roughness, since glossy floors stretch
 * reflections along the view. A tap-only blur left ghosted copies.
 */
/** gain: day and night strength (Cycles' day plaza shows only a faint sheen; at night the lit facade reads clearly). */
export const PLANAR = { planeZ: 0.04, maxEyeZ: 80, scale: 0.5, gain: { day: 0.3, night: 0.7 }, minRough: 0.5, lodPerRough: 7, smear: 0.12 } as const;
const PLANAR_RE = /^M_(Paving|Plaza)\b/;
export const isPlanarMaterial = (name: string) => PLANAR_RE.test(name);
/** Worth rendering: the eye is outside the bowl and low enough to see the plaza at a glancing angle. */
export const reflectionActive = (eyeB: V3) => eyeB[2] < PLANAR.maxEyeZ && !isInside(eyeB);

export interface PlanarUniforms { tReflect: { value: THREE.Texture }; uReflectMatrix: { value: THREE.Matrix4 }; uReflectOn: { value: number } }

/** GLSL (with PARS): the mirror image at this fragment, box-blurred with the surface roughness. */
export const PLANAR_GLSL = /* glsl */ `
#ifdef PLANAR_REFLECT
uniform sampler2D tReflect; uniform mat4 uReflectMatrix; uniform float uReflectOn;
vec3 planarReflection( float roughness ) {
  vec4 c = uReflectMatrix * vec4( vWorldPosB.x, vWorldPosB.z, -vWorldPosB.y, 1.0 );   // three world position
  float r = max( roughness, ${PLANAR.minRough.toFixed(2)} ), lod = r * ${PLANAR.lodPerRough.toFixed(1)};
  vec2 uv = c.xy / c.w;
  vec3 s = vec3( 0.0 ); float wsum = 0.0;
  for ( int i = -3; i <= 3; i++ ) {                      // vertical smear of the blurred mip
    float t = float( i ) / 3.0, w = exp( -2.0 * t * t );
    s += textureLod( tReflect, uv + vec2( 0.0, r * ${PLANAR.smear.toFixed(3)} * t ), lod ).rgb * w; wsum += w;
  }
  return s / wsum * mix( ${PLANAR.gain.day.toFixed(2)}, ${PLANAR.gain.night.toFixed(2)}, uNight );
}
#endif
`;

export class PlazaReflection {
  readonly uniforms: PlanarUniforms;
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  private cam = new THREE.PerspectiveCamera();
  private dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLANAR.planeZ)];   // keeps y > planeZ (three is Y-up)
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private size = new THREE.Vector2();
  private v = new THREE.Vector3();
  constructor() {
    this.dummy.needsUpdate = true;
    this.uniforms = { tReflect: { value: this.dummy }, uReflectMatrix: { value: new THREE.Matrix4() }, uReflectOn: { value: 0 } };
  }
  /** Renders the mirror image when it is worth it; call before the main render. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, eyeB: V3) {
    const on = reflectionActive(eyeB);
    this.uniforms.uReflectOn.value = on ? 1 : 0;
    if (!on) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * PLANAR.scale)), h = Math.max(1, Math.round(this.size.y * PLANAR.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    // mirror the camera about y = planeZ: position, view direction and up
    const c = this.cam, mirror = (p: THREE.Vector3) => p.set(p.x, 2 * PLANAR.planeZ - p.y, p.z);
    camera.updateMatrixWorld();
    c.copy(camera);
    mirror(c.position.copy(camera.position));
    const look = mirror(this.v.set(0, 0, -1).transformDirection(camera.matrixWorld).add(camera.position));
    c.up.set(0, 1, 0).transformDirection(camera.matrixWorld);
    c.up.y = -c.up.y;
    c.lookAt(look);
    c.projectionMatrix.copy(camera.projectionMatrix);
    c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    c.updateMatrixWorld();
    this.uniforms.uReflectMatrix.value.copy(this.bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // the plaza must not sample the target being rendered
    this.uniforms.tReflect.value = this.dummy;
    this.uniforms.uReflectOn.value = 0;
    const prevTarget = renderer.getRenderTarget(), prevClip = renderer.clippingPlanes, prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.clippingPlanes = this.clip;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(prevTarget);
    renderer.clippingPlanes = prevClip;
    renderer.shadowMap.autoUpdate = prevShadow;
    this.uniforms.tReflect.value = this.target.texture;
    this.uniforms.uReflectOn.value = 1;
  }
}
