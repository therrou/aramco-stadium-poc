import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseSeats, indexSections, SeatDirectory } from "./seatsData";
import type { SectionsDoc } from "./loader";
import { Availability, FEATURED_PAIR, SeatStatus, byFree, seatPrice, soldShares, standOf } from "./ticketing";
import { TicketStore, TICKETS_KEY } from "./tickets";

// sections.json and seats.bin are build products (gitignored), so the data checks run where the assets are built
const assets = new URL("../public/assets/", import.meta.url);
const built = existsSync(new URL("seats.bin", assets)) && existsSync(new URL("sections.json", assets));
const load = () => {
  const doc: SectionsDoc = JSON.parse(readFileSync(new URL("sections.json", assets), "utf8"));
  const b = readFileSync(new URL("seats.bin", assets));
  const table = parseSeats(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { doc, table, dir: new SeatDirectory(table, indexSections(table)) };
};
const { doc, table, dir } = built ? load() : ({} as ReturnType<typeof load>);

describe("stands", () => {
  it("splits each tier by angle: sidelines at 90/270, ends behind the goals at 0/180", () => {
    expect([270, 90, 0, 360, 180, 44, 45, 225].map(standOf)).toEqual(
      ["South Sideline", "North Sideline", "East End", "East End", "West End", "East End", "North Sideline", "South Sideline"]);
  });
  it.skipIf(!built)("gives each tier's 44 sections to 4 stands of about 11", () => {
    for (const tier of ["Lower", "Club", "Upper"]) {
      const n = new Map<string, number>();
      for (const s of doc.sections.filter((x) => x.tier === tier)) n.set(standOf(s.angle_deg), (n.get(standOf(s.angle_deg)) ?? 0) + 1);
      expect([...n.values()].every((v) => v >= 9 && v <= 13)).toBe(true);
    }
  });
});

describe("prices", () => {
  it("cost more closer to the pitch: front rows, sidelines, Club", () => {
    expect(seatPrice("Lower", 270, 1, 24)).toBeGreaterThan(seatPrice("Lower", 270, 24, 24));
    expect(seatPrice("Lower", 270, 6, 24)).toBeGreaterThan(seatPrice("Lower", 0, 6, 24));
    expect(seatPrice("Club", 0, 3, 3)).toBeGreaterThan(seatPrice("Lower", 270, 1, 24));
    expect(seatPrice("Upper", 0, 28, 28) % 5).toBe(0);
  });
});

describe.skipIf(!built)("availability", () => {
  const av = built ? new Availability(dir, doc.sections) : (null as unknown as Availability);
  it("sells about 60% overall, seeded (same every load)", () => {
    const sold = av.status.reduce((n, s) => n + (s === SeatStatus.Sold ? 1 : 0), 0) / table.count;
    expect(sold).toBeGreaterThan(0.56);
    expect(sold).toBeLessThan(0.64);
    expect(new Availability(dir, doc.sections).status).toEqual(av.status);
  });
  it("fills sidelines more than the Upper ends", () => {
    const sh = soldShares(doc.sections);
    expect(sh.get(103)!).toBeGreaterThan(sh.get(334)!);
    const side = av.sectionStats(301), end = av.sectionStats(312);
    expect(side.free / side.total).toBeLessThan(end.free / end.total);
  });
  it("keeps the featured pair as the only adjacent free seats of a ~97% sold section", () => {
    for (const r of FEATURED_PAIR) expect(av.at(r)).toBe(SeatStatus.Free);
    expect(av.freeNeighbour(FEATURED_PAIR[0])).toEqual(FEATURED_PAIR[1]);
    const s = av.sectionStats(FEATURED_PAIR[0].section);
    expect(s.free / s.total).toBeLessThan(0.04);
    let pairs = 0;
    for (const row of dir.rows(101)) {
      const seats = dir.seats(101, row);
      for (let k = 1; k < seats.length; k++)
        if (av.at({ section: 101, row, seat: seats[k] }) === SeatStatus.Free && av.at({ section: 101, row, seat: seats[k - 1] }) === SeatStatus.Free) pairs++;
    }
    expect(pairs).toBe(1);
  });
  it("marks the buyer's seats and frees them again on reset", () => {
    const a = new Availability(dir, doc.sections, [FEATURED_PAIR[0]]);
    expect(a.at(FEATURED_PAIR[0])).toBe(SeatStatus.Mine);
    a.setMine([]);
    expect(a.at(FEATURED_PAIR[0])).toBe(SeatStatus.Free);
  });
});

describe("sorting", () => {
  it("sorts most free first", () => {
    const xs = byFree([{ key: 1, stats: { free: 1, total: 10, from: 0 } }, { key: 2, stats: { free: 8, total: 10, from: 0 } }]);
    expect(xs.map((x) => x.key)).toEqual([2, 1]);
  });
});

describe("ticket store", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
  it("persists purchases across instances and ignores junk", () => {
    const s = mem();
    new TicketStore(s).add([{ section: 101, row: 6, seat: 7, price: 480, name: "A", email: "a@b.co", at: 1 }]);
    expect(new TicketStore(s).has({ section: 101, row: 6, seat: 7 })).toBe(true);
    s.setItem(TICKETS_KEY, "{not json");
    expect(new TicketStore(s).all()).toEqual([]);
  });
  it("does not add a seat twice, and clears", () => {
    const s = mem(), t = new TicketStore(s), k = { section: 1, row: 1, seat: 1, price: 1, name: "", email: "", at: 0 };
    t.add([k]); t.add([k]);
    expect(t.all()).toHaveLength(1);
    t.clear();
    expect(new TicketStore(s).all()).toEqual([]);
  });
});
