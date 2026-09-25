import type { V3 } from "./coords";
import type { Section } from "./loader";
import type { Tier } from "./tiers";

export interface SeatTable { count: number; section: Uint16Array; row: Uint8Array; seat: Uint16Array; pos: Float32Array; yaw: Float32Array }
const HEADER = 16, RECORD = 19;

function f16(h: number) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

/** seats.bin, see scripts/webexport/seatbin.py (Blender Z-up metres). */
export function parseSeats(buf: ArrayBuffer): SeatTable {
  const dv = new DataView(buf);
  if (buf.byteLength < HEADER || String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "SEAT") throw new Error("seats.bin: bad magic");
  const count = dv.getUint32(8, true);
  if (buf.byteLength !== HEADER + count * RECORD) throw new Error(`seats.bin: length ${buf.byteLength}`);
  const t: SeatTable = { count, section: new Uint16Array(count), row: new Uint8Array(count), seat: new Uint16Array(count), pos: new Float32Array(count * 3), yaw: new Float32Array(count) };
  for (let i = 0, o = HEADER; i < count; i++, o += RECORD) {
    t.section[i] = dv.getUint16(o, true);
    t.row[i] = dv.getUint8(o + 2);
    t.seat[i] = dv.getUint16(o + 3, true);
    t.pos[i * 3] = dv.getFloat32(o + 5, true);
    t.pos[i * 3 + 1] = dv.getFloat32(o + 9, true);
    t.pos[i * 3 + 2] = dv.getFloat32(o + 13, true);
    t.yaw[i] = f16(dv.getUint16(o + 17, true));
  }
  return t;
}

/**
 * Seats are contiguous per section in seats.bin (scripts/webexport/export_web.py's stage_data
 * sorts rows by section via seatbin.sort_by_section before packing, since data/seats.csv itself
 * is row-major across sections). This function stays pure (no mutation of `t`) and throws if
 * that contract is ever violated, rather than silently computing a wrong {start,end} range.
 */
export function indexSections(t: SeatTable) {
  const idx = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < t.count; i++) {
    const sec = t.section[i];
    const r = idx.get(sec);
    if (r) {
      if (r.end !== i) throw new Error(`seats.bin: section ${sec} is not contiguous`);
      r.end = i + 1;
    } else {
      idx.set(sec, { start: i, end: i + 1 });
    }
  }
  return idx;
}

export interface SeatRef { section: number; row: number; seat: number }
/** `?seat=` and sections.json `view.seat` format: section-row-seat. */
export const formatSeat = (r: SeatRef) => `${r.section}-${r.row}-${r.seat}`;
export function parseSeatParam(v: string | null): SeatRef | null {
  const m = /^(\d{1,5})-(\d{1,3})-(\d{1,5})$/.exec(v ?? "");
  return m ? { section: Number(m[1]), row: Number(m[2]), seat: Number(m[3]) } : null;
}

export const sectionsOfTier = (sections: Section[], tier: Tier) =>
  sections.filter((s) => s.tier === tier).map((s) => Number(s.id)).sort((a, b) => a - b);

/** Section -> row -> seat lookups over seats.bin (seat finder option lists, links, picking). */
export class SeatDirectory {
  /** section -> row -> seat indices sorted by seat number; rows in numeric order. */
  private bySection = new Map<number, Map<number, number[]>>();
  constructor(readonly t: SeatTable, idx: Map<number, { start: number; end: number }>) {
    for (const [sec, { start, end }] of idx) {
      const rows = new Map<number, number[]>();
      for (let i = start; i < end; i++) (rows.get(t.row[i]) ?? rows.set(t.row[i], []).get(t.row[i])!).push(i);
      for (const ids of rows.values()) ids.sort((a, b) => t.seat[a] - t.seat[b]);
      this.bySection.set(sec, new Map([...rows].sort((a, b) => a[0] - b[0])));
    }
  }
  rows(section: number) { return [...(this.bySection.get(section)?.keys() ?? [])]; }
  seats(section: number, row: number) { return (this.bySection.get(section)?.get(row) ?? []).map((i) => this.t.seat[i]); }
  find(r: SeatRef) { return this.bySection.get(r.section)?.get(r.row)?.find((i) => this.t.seat[i] === r.seat) ?? -1; }
  ref(i: number): SeatRef { return { section: this.t.section[i], row: this.t.row[i], seat: this.t.seat[i] }; }
  position(i: number): V3 { return [this.t.pos[i * 3], this.t.pos[i * 3 + 1], this.t.pos[i * 3 + 2]]; }
}
