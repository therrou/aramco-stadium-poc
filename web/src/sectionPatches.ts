import * as THREE from "three";
import { toThree, type V3 } from "./coords";
import type { SeatTable } from "./seatsData";
import type { Avail } from "./availability";
import { patchOutdoorLight, type OutdoorUniforms } from "./treeLight";

/** Per row: first and last seat of the row, lifted 0.5 m (Blender coords). */
export function stripVertices(t: SeatTable, idx: Map<number, { start: number; end: number }>, section: number): V3[] {
  const r = idx.get(section)!, rows = new Map<number, number[]>();
  for (let i = r.start; i < r.end; i++) (rows.get(t.row[i]) ?? rows.set(t.row[i], []).get(t.row[i])!).push(i);
  const out: V3[] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const ids = rows.get(row)!.sort((a, b) => t.seat[a] - t.seat[b]);
    for (const i of [ids[0], ids[ids.length - 1]]) out.push([t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2] + 0.5]);
  }
  return out;
}

/** One mesh for all section patches: drawn when seats are hidden, and always used for picking. */
export class SectionPatches {
  mesh: THREE.Mesh;
  private faceSection: number[] = [];
  private hidden: THREE.DataTexture;
  private slot = new Map<number, number>();
  private hiddenIds = new Set<number>();
  constructor(t: SeatTable, idx: Map<number, { start: number; end: number }>, avail: Uint8Array, outdoor?: OutdoorUniforms) {
    const pos: number[] = [], col: number[] = [], sec: number[] = [];
    const green = new THREE.Color(0x2fbf71), grey = new THREE.Color(0x6b6f76), c = new THREE.Color();
    [...idx.keys()].forEach((id, k) => {
      this.slot.set(id, k);
      const { start, end } = idx.get(id)!;
      let taken = 0; for (let i = start; i < end; i++) taken += avail[i] as Avail;
      c.copy(green).lerp(grey, taken / (end - start));
      const v = stripVertices(t, idx, id).map((p) => toThree(p));
      for (let r = 0; r + 3 < v.length; r += 2) {
        for (const q of [v[r], v[r + 1], v[r + 2], v[r + 1], v[r + 3], v[r + 2]]) { pos.push(q.x, q.y, q.z); col.push(c.r, c.g, c.b); sec.push(k); }
        this.faceSection.push(id, id);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSlot", new THREE.Float32BufferAttribute(sec, 1));
    g.computeVertexNormals();
    const slots = Math.max(1, idx.size);
    this.hidden = new THREE.DataTexture(new Uint8Array(slots), slots, 1, THREE.RedFormat);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uHidden = { value: this.hidden };
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSlot;\nuniform sampler2D uHidden;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (texelFetch(uHidden, ivec2(int(aSlot), 0), 0).r > 0.5) gl_Position = vec4(0.0);");
    };
    if (outdoor) patchOutdoorLight(mat, outdoor, "patches-outdoor");   // R11; composes with the hide patch above
    this.mesh = new THREE.Mesh(g, mat);
  }
  sectionOfFace(face: number) { return this.faceSection[face] ?? -1; }
  setHidden(ids: Set<number>) {
    if (ids.size === this.hiddenIds.size && [...ids].every((i) => this.hiddenIds.has(i))) return;
    this.hiddenIds = ids;
    const d = this.hidden.image.data as Uint8Array;
    d.fill(0);
    for (const id of ids) d[this.slot.get(id)!] = 255;
    this.hidden.needsUpdate = true;
  }
}
