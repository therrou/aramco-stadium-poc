import * as THREE from "three";
import { toThree, type V3 } from "./coords";
import type { SeatTable } from "./seatsData";
import { tierAlbedo, type Tier } from "./tiers";
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

/**
 * D7 (v3): the far stands were flat colour slabs. Each strip quad spans one row to the next; the pattern
 * draws the concrete tread in front of the seats, the seats with a shaded underside, and the gaps between
 * seats, and fades each part to its average once it is below a pixel (fwidth), so distant stands keep the
 * same mean tone without shimmer. uv = (metres along the row, 0 at this row -> 1 at the next).
 */
export const SEAT_ROWS_GLSL = /* glsl */ `
float bandAA( float x, float a, float b, float w ) { return smoothstep( a - w, a + w, x ) - smoothstep( b - w, b + w, x ); }
float seatRows( vec2 uv, float seatW ) { return 1.0; }   // kept for the test contract; see seatRowsColor
vec3 seatRowsColor( vec3 seat, vec2 uv, float seatW ) {
  vec2 fw = max( fwidth( uv ), vec2( 1e-5 ) );
  // concrete tread in front of the seats (light), shadow under the pans (dark), thin gaps between seats
  float tread = bandAA( uv.y, -0.1, 0.24, fw.y ) + bandAA( uv.y, 0.97, 1.2, fw.y );
  float under = bandAA( uv.y, 0.24, 0.42, fw.y );
  float d = abs( fract( uv.x / seatW + 0.5 ) - 0.5 ) * seatW;
  float gap = 1.0 - smoothstep( 0.025 - fw.x, 0.025 + fw.x, d );
  float fr = smoothstep( 0.35, 0.7, fw.y ), fs = smoothstep( 0.3 * seatW, 0.8 * seatW, fw.x );
  tread = mix( tread, 0.27, fr ); under = mix( under, 0.18, fr ); gap = mix( gap, 0.05 / seatW, fs );
  vec3 c = mix( seat, vec3( 0.42, 0.42, 0.41 ), 0.85 * tread );
  return c * ( 1.0 - 0.5 * under ) * ( 1.0 - 0.25 * gap );
}`;

/** One mesh for all section patches: drawn when seats are hidden, and always used for picking. */
export class SectionPatches {
  mesh: THREE.Mesh;
  private faceSection: number[] = [];
  private hidden: THREE.DataTexture;
  private slot = new Map<number, number>();
  private hiddenIds = new Set<number>();
  constructor(t: SeatTable, idx: Map<number, { start: number; end: number }>, outdoor?: OutdoorUniforms,
              tierOf: (id: number) => Tier | undefined = () => undefined) {
    const pos: number[] = [], col: number[] = [], sec: number[] = [], ruv: number[] = [], sw: number[] = [];
    const c = new THREE.Color();
    [...idx.keys()].forEach((id, k) => {
      this.slot.set(id, k);
      tierAlbedo(tierOf(id) ?? "Lower", c);   // A6 (v2): tier colour at the Cycles seat brightness
      const v = stripVertices(t, idx, id).map((p) => toThree(p)), w = tierOf(id) === "Club" ? 0.58 : 0.5;
      for (let r = 0; r + 3 < v.length; r += 2) {
        const la = v[r].distanceTo(v[r + 1]), lb = v[r + 2].distanceTo(v[r + 3]);
        const uvs = [[0, 0], [la, 0], [0, 1], [la, 0], [lb, 1], [0, 1]];
        [v[r], v[r + 1], v[r + 2], v[r + 1], v[r + 3], v[r + 2]].forEach((q, j) => {
          pos.push(q.x, q.y, q.z); col.push(c.r, c.g, c.b); sec.push(k); ruv.push(uvs[j][0], uvs[j][1]); sw.push(w);
        });
        this.faceSection.push(id, id);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSlot", new THREE.Float32BufferAttribute(sec, 1));
    g.setAttribute("aRowUV", new THREE.Float32BufferAttribute(ruv, 2));
    g.setAttribute("aSeatW", new THREE.Float32BufferAttribute(sw, 1));
    g.computeVertexNormals();
    const slots = Math.max(1, idx.size);
    this.hidden = new THREE.DataTexture(new Uint8Array(slots), slots, 1, THREE.RedFormat);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uHidden = { value: this.hidden };
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSlot;\nuniform sampler2D uHidden;\nattribute vec2 aRowUV; attribute float aSeatW; varying vec2 vRowUV; varying float vSeatW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvRowUV = aRowUV; vSeatW = aSeatW;\nif (texelFetch(uHidden, ivec2(int(aSlot), 0), 0).r > 0.5) gl_Position = vec4(0.0);");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vRowUV; varying float vSeatW;\n" + SEAT_ROWS_GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = seatRowsColor( diffuseColor.rgb, vRowUV, vSeatW );");
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
