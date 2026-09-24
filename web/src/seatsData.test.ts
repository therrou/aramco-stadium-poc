import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSeats, indexSections, type SeatTable } from "./seatsData";

const buf = () => { const b = readFileSync(new URL("../test/fixtures/seats_sample.bin", import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe("seats.bin (contract with scripts/webexport/seatbin.py)", () => {
  it("parses the Python fixture", () => {
    const t = parseSeats(buf());
    expect(t.count).toBe(3);
    expect([t.section[1], t.row[1], t.seat[1]]).toEqual([212, 2, 17]);
    expect(t.pos[3]).toBeCloseTo(12.5, 4);
    expect(t.pos[5]).toBeCloseTo(14.9, 4);
    expect(t.yaw[2]).toBeCloseTo(-2.3562, 2);
  });
  it("rejects bad magic and truncation", () => {
    const b = new Uint8Array(buf()); b[0] = 0;
    expect(() => parseSeats(b.buffer)).toThrow(/magic/);
    expect(() => parseSeats(buf().slice(0, 72))).toThrow(/length/);
  });
  it("indexes sections", () => {
    const t = parseSeats(buf());
    const idx = indexSections(t);
    expect(idx.get(212)).toEqual({ start: 1, end: 2 });
    expect(idx.get(101)).toEqual({ start: 0, end: 1 });
  });
  it("does not mutate the table", () => {
    const t = parseSeats(buf());
    const before = [...t.section];
    indexSections(t);
    expect([...t.section]).toEqual(before);
  });
  it("throws if a section is not contiguous", () => {
    const t: SeatTable = {
      count: 3,
      section: new Uint16Array([101, 212, 101]),
      row: new Uint8Array(3),
      seat: new Uint16Array(3),
      pos: new Float32Array(9),
      yaw: new Float32Array(3),
    };
    expect(() => indexSections(t)).toThrow(/section 101 is not contiguous/);
  });
});
