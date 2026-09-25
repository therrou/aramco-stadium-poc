import * as THREE from "three";

/** Click (not drag) -> normalised device coordinates. */
export function onClick(dom: HTMLElement, cb: (ndc: THREE.Vector2) => void) {
  let down: [number, number] | null = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;                                   // final review 9: one pointerdown, at most one click
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
    const r = dom.getBoundingClientRect();
    cb(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
  });
}

/**
 * Final review 6: patches sit 0.5 m above the seat rows, so a patch seen through the building (roof,
 * sails, concourse) must not be picked. Accept the patch hit only if it is no farther than the first
 * stadium hit plus `eps` (the patch plane and the tier treads are close; railings may poke through it).
 */
export const PICK_EPS_M = 1.0;
export function acceptPatchHit(patchDist: number | undefined, stadiumDist: number | undefined, eps = PICK_EPS_M) {
  if (patchDist === undefined) return false;
  return stadiumDist === undefined || patchDist <= stadiumDist + eps;
}

/**
 * Distance from the camera to the first stadium surface under one pixel, rendered on the GPU: the scene
 * is drawn into a 1x1 float target through a view offset, with a material that writes the fragment's
 * distance to the camera. A CPU raycast of the ~900k stadium triangles took ~1 s per click here.
 * DoubleSide: any surface on the ray occludes, whichever way it faces. Returns undefined for no hit.
 */
export class DepthProbe {
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: true });
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera();
  private buf = new Float32Array(4);
  private clear = new THREE.Color();
  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.overrideMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "varying vec3 vW; void main() { gl_FragColor = vec4( length( vW - cameraPosition ), 1.0, 0.0, 1.0 ); }",
    });
  }
  /** `root` is borrowed for the draw and handed back to its parent. */
  distance(root: THREE.Object3D, camera: THREE.PerspectiveCamera, ndc: THREE.Vector2): number | undefined {
    const W = 4096, H = W / camera.aspect;
    this.cam.copy(camera);
    this.cam.setViewOffset(W, H, ((ndc.x + 1) / 2) * W - 0.5, ((1 - ndc.y) / 2) * H - 0.5, 1, 1);
    const parent = root.parent, r = this.renderer, prevTarget = r.getRenderTarget(), alpha = r.getClearAlpha();
    r.getClearColor(this.clear);
    this.scene.add(root);
    try {
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, this.cam);
      r.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.buf);
    } finally {
      parent?.add(root);
      r.setRenderTarget(prevTarget);
      r.setClearColor(this.clear, alpha);
    }
    return this.buf[1] > 0.5 ? this.buf[0] : undefined;
  }
}
