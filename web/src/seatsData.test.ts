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

import { SeatDirectory, formatSeat, parseSeatParam, sectionsOfTier } from "./seatsData";
import type { Section } from "./loader";

const table = (): SeatTable => ({
  count: 5,
  section: new Uint16Array([101, 101, 101, 212, 212]),
  row: new Uint8Array([2, 1, 1, 10, 10]),
  seat: new Uint16Array([1, 7, 3, 4, 5]),
  pos: new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  yaw: new Float32Array(5),
});
describe("seat directory (spec part 2: only real rows and seats are offered)", () => {
  const t = table(), dir = new SeatDirectory(t, indexSections(t));
  it("rows and seats are sorted numerically", () => {
    expect(dir.rows(101)).toEqual([1, 2]);
    expect(dir.seats(101, 1)).toEqual([3, 7]);
    expect(dir.seats(212, 10)).toEqual([4, 5]);
  });
  it("unknown section/row gives empty lists", () => {
    expect(dir.rows(999)).toEqual([]);
    expect(dir.seats(101, 9)).toEqual([]);
  });
  it("finds a seat index and back", () => {
    expect(dir.find({ section: 101, row: 1, seat: 3 })).toBe(2);
    expect(dir.ref(2)).toEqual({ section: 101, row: 1, seat: 3 });
    expect(dir.position(2)).toEqual([4, 5, 6]);
    expect(dir.find({ section: 101, row: 1, seat: 4 })).toBe(-1);
    expect(dir.find({ section: 999, row: 1, seat: 1 })).toBe(-1);
  });
});
describe("?seat= links (Review Focus 1)", () => {
  it("round trips", () => {
    const r = { section: 212, row: 10, seat: 4 };
    expect(formatSeat(r)).toBe("212-10-4");
    expect(parseSeatParam(formatSeat(r))).toEqual(r);
  });
  it("rejects malformed values", () => {
    for (const v of [null, "", "212-10", "212-10-4-1", "abc", "212-x-4", "-1-2-3", "212-10-4 "]) expect(parseSeatParam(v)).toBeNull();
  });
});
it("sections of a tier, numeric order", () => {
  const s = [{ id: "112", tier: "Lower" }, { id: "201", tier: "Club" }, { id: "101", tier: "Lower" }] as Section[];
  expect(sectionsOfTier(s, "Lower")).toEqual([101, 112]);
});
