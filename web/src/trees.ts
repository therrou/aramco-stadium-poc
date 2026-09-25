import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { V3 } from "./coords";
import { patchTreeMaterial, type TreeUniforms } from "./treeLight";

export interface Impostor { atlas: THREE.Texture; frames: number; size: number; centerZ: number }

/** Inverse of scripts/webexport/hemioct.py cell_dir (Blender Z-up). */
export function hemiOctCell([x, y, z]: V3, n: number): [number, number] {
  z = Math.max(z, 0);
  const s = Math.abs(x) + Math.abs(y) + z || 1;
  const px = x / s, py = y / s;
  const u = px + py, v = px - py;                                   // back to [-1, 1]^2
  const cell = (c: number) => Math.min(n - 1, Math.max(0, Math.floor(((c + 1) / 2) * n)));
  return [cell(u), cell(v)];
}

const IMPOSTOR_VS = /* glsl */ `
uniform float uSize; uniform float uCenterZ; uniform float uFrames;
varying vec2 vUv; varying vec2 vCell; varying vec2 vCellF;
vec2 cellOf(vec3 d) {
  d.z = max(d.z, 0.0); d /= max(abs(d.x) + abs(d.y) + d.z, 1e-6);
  vec2 uv = vec2(d.x + d.y, d.x - d.y);
  return clamp(floor((uv + 1.0) * 0.5 * uFrames), 0.0, uFrames - 1.0);
}
// D9 (v3): continuous cell position, for blending the four nearest frames
vec2 cellF(vec3 d) {
  d.z = max(d.z, 0.0); d /= max(abs(d.x) + abs(d.y) + d.z, 1e-6);
  return clamp((vec2(d.x + d.y, d.x - d.y) + 1.0) * 0.5 * uFrames - 0.5, 0.0, uFrames - 1.0);
}
void main() {
#ifdef USE_INSTANCING
  mat4 w = modelMatrix * instanceMatrix;
#else
  mat4 w = modelMatrix;
#endif
  vec4 c = w * vec4(0.0, uCenterZ, 0.0, 1.0);                       // Three space, tree centre
  vec3 camL = inverse(mat3(w)) * (cameraPosition - c.xyz);            // tree-local, Y-up
  vec3 dB = normalize(vec3(camL.x, -camL.z, camL.y));                // to Blender local (Z-up)
  vCell = cellOf(dB);
  vCellF = cellF(dB);
  float scale = length(w[0].xyz);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 p = c.xyz + (right * position.x + up * (position.y - 0.5)) * uSize * scale;   // Blender quad z -> glTF y
  vUv = vec2(position.x + 0.5, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
export const IMPOSTOR_FS_SRC = /* glsl */ `
uniform sampler2D uAtlas; uniform float uFrames; uniform vec3 uSun; uniform vec3 uAmbient;
varying vec2 vUv; varying vec2 vCell; varying vec2 vCellF;
vec4 frame(vec2 cell, vec2 uv) { vec4 t = texture2D(uAtlas, vec2((cell.x + uv.x) / uFrames, 1.0 - (cell.y + uv.y) / uFrames)); return vec4(t.rgb * t.a, t.a); }  // Task 12 convention; premultiplied for blending
void main() {
  vec2 uv = clamp(vUv, 0.002, 0.998);                                 // no bleed into the neighbour frame
  // D9 (v3): blend the four nearest view frames, so orbiting does not snap between them
  vec2 c0 = floor(vCellF), f = vCellF - c0, c1 = min(c0 + 1.0, uFrames - 1.0);
  vec4 c = mix(mix(frame(c0, uv), frame(vec2(c1.x, c0.y), uv), f.x), mix(frame(vec2(c0.x, c1.y), uv), frame(c1, uv), f.x), f.y);
  if (c.a < 0.1) discard;
  gl_FragColor = vec4(c.rgb / max(c.a, 1e-3) * (uAmbient + 0.19 * uSun), smoothstep(0.25, 0.6, c.a));  // 0.19 ~ 0.6 (mean N.L) / PI; alpha -> coverage
}`;

/** Impostor species from the material (node names are dropped by `gltf-transform instance`). */
export function impostorSpecies(mat: THREE.Material): string | undefined {
  return (mat.userData?.impostor as string | undefined) ?? /^Impostor_(.+?)(\.\d+)?$/.exec(mat.name)?.[1];
}

export function setupTrees(gltf: GLTF, impostors: Record<string, Impostor>, u: TreeUniforms) {
  const done = new Set<THREE.Material>();
  const hide: THREE.Object3D[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isMesh) return;
    const sp = impostorSpecies(m.material as THREE.Material);
    if (sp) {
      const im = impostors[sp];
      if (!im) { hide.push(m); return; }                              // atlas missing: drop far trees rather than grey quads
      m.material = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: im.atlas }, uFrames: { value: im.frames }, uSize: { value: im.size }, uCenterZ: { value: im.centerZ }, uSun: u.uSun, uAmbient: u.uAmbient },
        vertexShader: IMPOSTOR_VS, fragmentShader: IMPOSTOR_FS_SRC, side: THREE.DoubleSide, alphaToCoverage: true,
      });
      m.frustumCulled = false;
    } else {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (done.has(mat)) continue;
        done.add(mat);
        patchTreeMaterial(mat as THREE.MeshStandardMaterial, u);
      }
    }
  });
  for (const o of hide) o.visible = false;
}
