import * as THREE from "three";

export type V3 = [number, number, number];

/** Blender Z-up metres -> Three Y-up (same as the glTF exporter). Decision D2. */
export const toThree = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
export const toBlender = (v: THREE.Vector3): V3 => [v.x, -v.z, v.y];

/** Blender equirect lookup: u = atan2(dir.y, -dir.x) / 2π + 0.5, v = atan2(dir.z, |dir.xy|) / π + 0.5. */
export function blenderEquirectUV([x, y, z]: V3): [number, number] {
  return [Math.atan2(y, -x) / (2 * Math.PI) + 0.5, Math.atan2(z, Math.hypot(x, y)) / Math.PI + 0.5];
}

/** Rotate Three's equirect/PMREM lookups by this about +Y so they match Blender's world. */
export const ENV_ROTATION_Y = Math.PI;
