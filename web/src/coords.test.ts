import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { toThree, toBlender, blenderEquirectUV, ENV_ROTATION_Y } from "./coords";

describe("coords", () => {
  it("maps Blender Z-up to Three Y-up", () => {
    expect(toThree([1, 2, 3]).toArray()).toEqual([1, 3, -2]);
    expect(toBlender(new THREE.Vector3(1, 3, -2))).toEqual([1, 2, 3]);
  });
  it("Three equirect of a rotated dir equals Blender equirect", () => {
    // three's equirectUv(dir) = (atan(dir.z, dir.x) / 2π + 0.5, asin(dir.y) / π + 0.5)
    for (const dB of [[1, 0, 0], [0, 1, 0], [-0.6, -0.8, 0], [0.3, -0.4, 0.866]] as const) {
      const d = toThree([...dB]).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -ENV_ROTATION_Y);
      const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5;
      const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5;
      const [ub, vb] = blenderEquirectUV([...dB]);
      expect(((u - ub + 1.5) % 1) - 0.5).toBeCloseTo(0, 6);
      expect(v).toBeCloseTo(vb, 6);
    }
  });
});
