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

/** D7 (v3): sections whose centroid is within this distance may draw the moulded seat... */
export const SEAT_NEAR_M = 28;
/** ...nearest first, up to this many seats, so the moulded seats add <= ~0.3 M triangles (budget 2 M). */
export const NEAR_SEAT_CAP = 2500;
export function nearSections(camB: V3, sections: Section[], dist: number, cap: number) {
  const d = (s: Section) => Math.hypot(s.centroid[0] - camB[0], s.centroid[1] - camB[1], s.centroid[2] - camB[2]);
  const out = new Set<number>();
  let n = 0;
  for (const s of sections.filter((x) => d(x) < dist).sort((a, b) => d(a) - d(b))) {
    if (n + s.seats > cap) break;
    out.add(Number(s.id));
    n += s.seats;
  }
  return out;
}

/**
 * D7 (v3): moulded stadium seat, ~150 tris, same slot as seatGeometry (front +X, origin at the tread, 0.44 m
 * wide): a dished pan with a raised front lip, a cupped back reclined 12 degrees, and a riser stem. Vertex
 * colours carry contact shading (undersides, the stem and the back's rear darker); instance colours tint it.
 */
export function seatGeometryHi() {
  const bend = (g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, v[0], v[1], v[2]); }
    return g;
  };
  const pan = bend(new THREE.BoxGeometry(0.40, 0.035, 0.44, 4, 1, 3), (x, y, z) => {
    const w = 1 - (z / 0.22) ** 2, lip = Math.max(0, (x - 0.12) / 0.08);
    return [x, y - 0.014 * w + 0.012 * lip * lip, z];
  }).rotateZ((-4 * Math.PI) / 180).translate(0.03, 0.44, 0);
  const back = bend(new THREE.BoxGeometry(0.03, 0.44, 0.44, 1, 3, 3), (x, y, z) => [x - 0.03 * (1 - (z / 0.22) ** 2), y, z])
    .rotateZ((12 * Math.PI) / 180).translate(-0.2, 0.7, 0);
  const stem = new THREE.BoxGeometry(0.05, 0.42, 0.07).translate(-0.15, 0.21, 0);
  const parts = [pan, back, stem].map((g, k) => {
    const n = g.toNonIndexed(), nrm = (n.computeVertexNormals(), n.attributes.normal), col: number[] = [];
    for (let i = 0; i < nrm.count; i++) {
      const down = nrm.getY(i) < -0.5, rear = nrm.getX(i) < -0.5;
      col.push(...Array(3).fill(k === 2 ? 0.45 : down ? 0.55 : rear && k === 1 ? 0.8 : 1));
    }
    n.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return n;
  });
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** Selected-seat highlight opacity, 1.2 s period. */
export const pulse = (t: number) => 0.625 + 0.275 * Math.sin((t * 2 * Math.PI) / 1.2);

/** A slightly larger white seat drawn over each selected one (the seat, plus a companion seat), pulsing (spec part 2). */
export class SeatHighlight {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private scale = new THREE.Matrix4().makeScale(1.08, 1.08, 1.08);
  constructor(max = 2) {
    this.mesh = new THREE.InstancedMesh(seatGeometryHi(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }), max);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }
  set(m: THREE.Matrix4 | null | THREE.Matrix4[]) {
    const ms = (Array.isArray(m) ? m : m ? [m] : []).slice(0, this.mesh.instanceMatrix.count);
    this.mesh.visible = ms.length > 0;
    this.mesh.count = ms.length;
    const t = new THREE.Matrix4();
    ms.forEach((x, i) => this.mesh.setMatrixAt(i, t.copy(x).multiply(this.scale)));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(t: number) { this.mesh.material.opacity = pulse(t); }
}

/** Ticketing tints (linear): sold seats of the section in focus go dark; the buyer's own seats are always gold. */
export const SOLD_RGB: [number, number, number] = [0.03, 0.035, 0.05];
export const MINE_RGB: [number, number, number] = [0.95, 0.62, 0.08];

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
  /** Block seats (far sections). */
  mesh: THREE.InstancedMesh;
  /** D7: moulded seats (sections within SEAT_NEAR_M). */
  near: THREE.InstancedMesh;
  private matrices: Float32Array;
  private colors: Float32Array;
  private base: Float32Array;
  private visible: Set<number> | null = null;   // null: nothing applied yet (the first call must not early-out)
  private nearIds = new Set<number>();
  private tierOf = new Map<number, Tier>();
  constructor(private t: SeatTable, private idx: Map<number, { start: number; end: number }>, sections: Section[], outdoor?: OutdoorUniforms) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    if (outdoor) patchOutdoorLight(mat, outdoor, "seats-outdoor");   // R11: no scene lights with lightmaps
    this.mesh = new THREE.InstancedMesh(seatGeometry(), mat, t.count);
    this.mesh.frustumCulled = false;
    // D7: moulded seats catch the light like plastic (roughness 0.45 + a sun highlight), contact-shaded
    const nearMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, vertexColors: true });
    if (outdoor) patchOutdoorLight(nearMat, outdoor, "seats-near-outdoor", { shine: 48, strength: 0.08 });
    this.near = new THREE.InstancedMesh(seatGeometryHi(), nearMat, t.count);
    this.near.frustumCulled = false;
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
    this.base = this.colors.slice();
    this.near.setColorAt(0, c);                        // allocates the near mesh's instance colours
    this.setVisibleSections(new Set());
  }
  /**
   * Ticketing: seat status per seats.bin index (0 free, 1 sold, 2 mine). Sold seats darken only in `focus`
   * sections, so the key visual keeps its colours; the buyer's seats are gold everywhere.
   */
  setStatus(status: Uint8Array, focus: Set<number>) {
    this.colors.set(this.base);
    for (let i = 0; i < this.t.count; i++) {
      const st = status[i];
      if (st === 2) this.colors.set(MINE_RGB, i * 3);
      else if (st === 1 && focus.has(this.t.section[i])) this.colors.set(SOLD_RGB, i * 3);
    }
    this.visible = null;                               // refill the packed buffers on the next setVisibleSections
  }
  /** Instance matrix of seat index i (seats.bin order). */
  matrixOf(i: number, out = new THREE.Matrix4()) { return out.fromArray(this.matrices, i * 16); }
  /**
   * Packs the visible sections' seats at the front of the instance buffers and draws only those
   * (`count`), so hidden seats cost nothing (Task 13: previously zero matrices, which still counted
   * ~1.1M triangles per frame). Instance ids are therefore not seat indices. Sections in `near` go to
   * the moulded-seat mesh, the rest to the block mesh (D7).
   */
  setVisibleSections(ids: Set<number>, near: Set<number> = new Set()): boolean {
    const cur = this.visible, same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((i) => b.has(i));
    if (cur && same(ids, cur) && same(near, this.nearIds)) return false;
    this.visible = ids;
    this.nearIds = near;
    const fill = (mesh: THREE.InstancedMesh, pick: (id: number) => boolean) => {
      const arr = mesh.instanceMatrix.array as Float32Array, col = mesh.instanceColor!.array as Float32Array;
      let n = 0;
      for (const id of [...ids].sort((a, b) => a - b)) {
        const r = this.idx.get(id);
        if (!r || !pick(id)) continue;
        arr.set(this.matrices.subarray(r.start * 16, r.end * 16), n * 16);
        col.set(this.colors.subarray(r.start * 3, r.end * 3), n * 3);
        n += r.end - r.start;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    };
    fill(this.near, (id) => near.has(id));
    fill(this.mesh, (id) => !near.has(id));
    return true;
  }
}
