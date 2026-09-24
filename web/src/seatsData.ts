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
