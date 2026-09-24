import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toThree, type V3 } from "./coords";
import type { Section } from "./loader";
import type { SeatTable } from "./seatsData";
import type { Avail } from "./availability";

export const SEAT_COLORS = { available: 0x2fbf71, taken: 0x6b6f76, club: 0xefe3c8 } as const;
export const SEAT_LOD_DIST = 80;   // m from camera to section centroid; the worst case is pinned in flyto.test.ts (Task 7). Lowered from 90 -> 80 (worst-case 30,379 -> 20,098 seats) to satisfy decision D6 (<=25k).
const CLUB_WIDTH = 0.58 / 0.5;     // params.CLUB.seat_w / LOWER.seat_w

/** Low-poly seat, two boxes (pan + back), 24 tris. Front faces +X; origin at the tread. */
export function seatGeometry() {
  const pan = new THREE.BoxGeometry(0.42, 0.06, 0.46).translate(0.02, 0.44, 0);
  const back = new THREE.BoxGeometry(0.06, 0.46, 0.46).translate(-0.2, 0.7, 0);
  const g = mergeGeometries([pan.toNonIndexed(), back.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

export function seatColor(tier: string, avail: Avail) {
  if (avail === 1) return SEAT_COLORS.taken;
  return tier === "Club" ? SEAT_COLORS.club : SEAT_COLORS.available;
}

/** Sections whose centroid is within `dist` of the camera (Blender coords). `always` stays visible. */
export function visibleSections(camB: V3, sections: Section[], dist: number, always = -1) {
  const out = new Set<number>();
  for (const s of sections) {
    const [x, y, z] = s.centroid;
    if (Math.hypot(x - camB[0], y - camB[1], z - camB[2]) < dist || Number(s.id) === always) out.add(Number(s.id));
  }
  return out;
}

export class SeatField {
  mesh: THREE.InstancedMesh;
  private matrices: Float32Array;
  private visible = new Set<number>();
  private tierOf = new Map<number, string>();
  constructor(private t: SeatTable, private idx: Map<number, { start: number; end: number }>, sections: Section[], public avail: Uint8Array) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(seatGeometry(), mat, t.count);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    this.matrices = new Float32Array(t.count * 16);
    for (let i = 0; i < t.count; i++) {
      const p = toThree([t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]]);
      q.setFromAxisAngle(up, t.yaw[i]);               // local +X -> Blender (cos yaw, sin yaw)
      const w = this.tierOf.get(t.section[i]) === "Club" ? CLUB_WIDTH : 1;
      m.compose(p, q, new THREE.Vector3(1, 1, w));
      m.toArray(this.matrices, i * 16);
      this.mesh.setColorAt(i, c.setHex(seatColor(this.tierOf.get(t.section[i])!, avail[i] as Avail)));
    }
    this.setVisibleSections(new Set());
  }
  /** Hidden seats get a zero matrix (degenerate triangles are culled before raster). */
  setVisibleSections(ids: Set<number>) {
    if (ids.size === this.visible.size && [...ids].every((i) => this.visible.has(i))) return;
    this.visible = ids;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    arr.fill(0);
    for (const id of ids) {
      const r = this.idx.get(id);
      if (r) arr.set(this.matrices.subarray(r.start * 16, r.end * 16), r.start * 16);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
