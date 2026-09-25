import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toThree, type V3 } from "./coords";
import type { Section } from "./loader";
import type { SeatTable } from "./seatsData";
import { patchOutdoorLight, type OutdoorUniforms } from "./treeLight";
import { tierAlbedo, type Tier } from "./tiers";

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

/** Selected-seat highlight opacity, 1.2 s period. */
export const pulse = (t: number) => 0.625 + 0.275 * Math.sin((t * 2 * Math.PI) / 1.2);

/** A slightly larger white seat drawn over the selected one, pulsing (spec part 2). */
export class SeatHighlight {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private scale = new THREE.Matrix4().makeScale(1.08, 1.08, 1.08);
  constructor() {
    this.mesh = new THREE.Mesh(seatGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }
  set(m: THREE.Matrix4 | null) {
    this.mesh.visible = m !== null;
    if (m) { this.mesh.matrix.copy(m).multiply(this.scale); this.mesh.matrixWorldNeedsUpdate = true; }
  }
  update(t: number) { this.mesh.material.opacity = pulse(t); }
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
  private colors: Float32Array;
  private visible: Set<number> | null = null;   // null: nothing applied yet (the first call must not early-out)
  private tierOf = new Map<number, Tier>();
  constructor(private t: SeatTable, private idx: Map<number, { start: number; end: number }>, sections: Section[], outdoor?: OutdoorUniforms) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    if (outdoor) patchOutdoorLight(mat, outdoor, "seats-outdoor");   // R11: no scene lights with lightmaps
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
      this.mesh.setColorAt(i, tierAlbedo(this.tierOf.get(t.section[i]) ?? "Lower", c));   // A6 (v2)
    }
    this.colors = (this.mesh.instanceColor!.array as Float32Array).slice();
    this.setVisibleSections(new Set());
  }
  /** Instance matrix of seat index i (seats.bin order). */
  matrixOf(i: number, out = new THREE.Matrix4()) { return out.fromArray(this.matrices, i * 16); }
  /**
   * Packs the visible sections' seats at the front of the instance buffers and draws only those
   * (`mesh.count`), so hidden seats cost nothing (Task 13: previously zero matrices, which still
   * counted ~1.1M triangles per frame). Instance ids are therefore not seat indices.
   */
  setVisibleSections(ids: Set<number>) {
    const cur = this.visible;
    if (cur && ids.size === cur.size && [...ids].every((i) => cur.has(i))) return;
    this.visible = ids;
    const arr = this.mesh.instanceMatrix.array as Float32Array, col = this.mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (const id of [...ids].sort((a, b) => a - b)) {
      const r = this.idx.get(id);
      if (!r) continue;
      arr.set(this.matrices.subarray(r.start * 16, r.end * 16), n * 16);
      col.set(this.colors.subarray(r.start * 3, r.end * 3), n * 3);
      n += r.end - r.start;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
