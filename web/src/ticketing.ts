import type { Section } from "./loader";
import type { SeatDirectory, SeatRef } from "./seatsData";
import type { Tier } from "./tiers";

/**
 * Ticketing (symbolic, user request 2026-09-27): stands per tier, prices by distance to the pitch, a seeded
 * 60% "sold" baseline and the buyer's own tickets on top. The pitch's long axis is Blender X: angle 0/180 are
 * the ends behind the goals, 90/270 the sidelines.
 */
export type Stand = "South Sideline" | "North Sideline" | "East End" | "West End";
export const STANDS: Stand[] = ["South Sideline", "North Sideline", "East End", "West End"];
export function standOf(angleDeg: number): Stand {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a >= 45 && a < 135) return "North Sideline";
  if (a >= 135 && a < 225) return "West End";
  if (a >= 225 && a < 315) return "South Sideline";
  return "East End";
}
/** 1 at mid-sideline, 0 behind the goals. */
const sideness = (angleDeg: number) => Math.abs(Math.sin((angleDeg * Math.PI) / 180));

export const CURRENCY = "SAR";
export const TIER_BASE: Record<Tier, number> = { Lower: 400, Club: 900, Upper: 150 };
export const SERVICE_FEE = 0.1;
export const formatPrice = (v: number) => `${CURRENCY} ${Math.round(v).toLocaleString("en")}`;
/** tier base x stand factor (sideline 1.0 .. ends 0.7) x row factor (front row 1.3 .. back row 0.85), to 5. */
export function seatPrice(tier: Tier, angleDeg: number, row: number, rows: number) {
  const stand = 0.7 + 0.3 * sideness(angleDeg);
  const rowF = 1.3 - 0.45 * (rows > 1 ? (row - 1) / (rows - 1) : 0);
  return Math.round((TIER_BASE[tier] * stand * rowF) / 5) * 5;
}

/** Seed-stable PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SOLD_TARGET = 0.6;
/** Always-present opportunity: a packed prime section with exactly one pair of adjacent seats left. */
export const FEATURED_PAIR: [SeatRef, SeatRef] = [{ section: 101, row: 6, seat: 7 }, { section: 101, row: 6, seat: 8 }];
const FEATURED_SINGLES = 6;   // isolated free seats left in the featured section, none next to another

/** Demand-weighted sold share per section (sidelines and Lower/Club fuller, Upper ends emptier), mean SOLD_TARGET. */
export function soldShares(sections: Section[]) {
  const raw = new Map<number, number>();
  const tierB: Record<Tier, [number, number]> = { Lower: [0.55, 0.35], Club: [0.58, 0.32], Upper: [0.36, 0.3] };
  for (const s of sections) {
    const [b, k] = tierB[s.tier], jitter = (rng(Number(s.id) * 7919)() - 0.5) * 0.08;
    raw.set(Number(s.id), b + k * sideness(s.angle_deg) + jitter);
  }
  const total = sections.reduce((n, s) => n + s.seats, 0), sold = sections.reduce((n, s) => n + s.seats * raw.get(Number(s.id))!, 0);
  const scale = (SOLD_TARGET * total) / sold;
  for (const [id, v] of raw) raw.set(id, Math.min(0.95, Math.max(0.2, v * scale)));
  return raw;
}

export const SeatStatus = { Free: 0, Sold: 1, Mine: 2 } as const;
export type SeatStatus = (typeof SeatStatus)[keyof typeof SeatStatus];

/** Seat status over seats.bin order: seeded sold blocks, the featured pair, and the buyer's tickets. */
export class Availability {
  readonly status: Uint8Array;
  private sectionOf = new Map<number, Section>();
  private listeners: (() => void)[] = [];
  constructor(readonly dir: SeatDirectory, sections: Section[], mine: SeatRef[] = []) {
    this.status = new Uint8Array(dir.t.count);
    for (const s of sections) this.sectionOf.set(Number(s.id), s);
    const shares = soldShares(sections);
    for (const s of sections) {
      const id = Number(s.id), rand = rng(id * 104729 + 17);
      if (id === FEATURED_PAIR[0].section) { this.packFeatured(id, rand); continue; }
      const f = shares.get(id)!;
      for (const row of dir.rows(id)) this.fillRow(this.rowIdx(id, row), f, rand);
    }
    for (const r of mine) this.markMine(r);
  }
  private rowIdx(section: number, row: number) { return this.dir.seats(section, row).map((seat) => this.dir.find({ section, row, seat })); }
  /** Alternating sold runs (2-6 seats, like group bookings) and free gaps sized so the row sells about `f`. */
  private fillRow(ids: number[], f: number, rand: () => number) {
    const gapMean = (4 * (1 - f)) / f;
    let k = Math.floor(rand() * (gapMean + 1));
    while (k < ids.length) {
      const run = 2 + Math.floor(rand() * 5);
      for (let j = 0; j < run && k < ids.length; j++, k++) this.status[ids[k]] = SeatStatus.Sold;
      k += Math.round(rand() * 2 * gapMean);
    }
  }
  private packFeatured(id: number, rand: () => number) {
    const all = this.dir.rows(id).flatMap((row) => this.rowIdx(id, row));
    for (const i of all) this.status[i] = SeatStatus.Sold;
    const pair = FEATURED_PAIR.map((r) => this.dir.find(r));
    for (const i of pair) if (i >= 0) this.status[i] = SeatStatus.Free;
    for (let n = 0, tries = 0; n < FEATURED_SINGLES && tries < 500; tries++) {
      const i = all[Math.floor(rand() * all.length)];
      if (this.status[i] !== SeatStatus.Sold) continue;
      const nb = this.neighbours(i);
      if (nb.some((j) => this.status[j] !== SeatStatus.Sold) || pair.some((p) => this.dir.t.row[p] === this.dir.t.row[i] && Math.abs(this.dir.t.seat[p] - this.dir.t.seat[i]) <= 2)) continue;
      this.status[i] = SeatStatus.Free;
      n++;
    }
  }
  /** Seats next to i in the same row (seat number +/- 1). */
  neighbours(i: number) {
    const t = this.dir.t, out: number[] = [];
    for (const d of [-1, 1]) {
      const j = this.dir.find({ section: t.section[i], row: t.row[i], seat: t.seat[i] + d });
      if (j >= 0) out.push(j);
    }
    return out;
  }
  at(r: SeatRef): SeatStatus { const i = this.dir.find(r); return i < 0 ? SeatStatus.Sold : (this.status[i] as SeatStatus); }
  /** A free seat right next to r, preferring the higher seat number. */
  freeNeighbour(r: SeatRef): SeatRef | null {
    const i = this.dir.find(r);
    if (i < 0) return null;
    const j = this.neighbours(i).reverse().find((n) => this.status[n] === SeatStatus.Free);
    return j === undefined ? null : this.dir.ref(j);
  }
  markMine(r: SeatRef) { const i = this.dir.find(r); if (i >= 0) this.status[i] = SeatStatus.Mine; }
  /** Rebuilds the buyer's seats: previous "mine" become free again (demo reset), then `mine` are applied. */
  setMine(mine: SeatRef[]) {
    for (let i = 0; i < this.status.length; i++) if (this.status[i] === SeatStatus.Mine) this.status[i] = SeatStatus.Free;
    for (const r of mine) this.markMine(r);
    this.listeners.forEach((f) => f());
  }
  onChange(f: () => void) { this.listeners.push(f); }
  section(id: number) { return this.sectionOf.get(id); }
  price(r: SeatRef) {
    const s = this.sectionOf.get(r.section);
    if (!s) return 0;
    const rows = this.dir.rows(r.section);
    return seatPrice(s.tier, s.angle_deg, rows.indexOf(r.row) + 1, rows.length);
  }
  /** Free / total seats of one section, and its cheapest free seat's price (or cheapest overall if sold out). */
  sectionStats(id: number) {
    let free = 0, total = 0, from = Infinity, any = Infinity;
    for (const row of this.dir.rows(id)) {
      const ids = this.rowIdx(id, row), p = this.price({ section: id, row, seat: 0 });
      total += ids.length;
      any = Math.min(any, p);
      const f = ids.filter((i) => this.status[i] === SeatStatus.Free).length;
      free += f;
      if (f) from = Math.min(from, p);
    }
    return { free, total, from: Number.isFinite(from) ? from : any };
  }
}

export interface Stats { free: number; total: number; from: number }
export const shareFree = (s: Stats) => (s.total ? s.free / s.total : 0);
export const sumStats = (xs: Stats[]): Stats =>
  ({ free: xs.reduce((n, x) => n + x.free, 0), total: xs.reduce((n, x) => n + x.total, 0), from: Math.min(...xs.map((x) => x.from)) });
/** Most free first; ties by id / name. */
export const byFree = <T extends { stats: Stats; key: string | number }>(xs: T[]) =>
  xs.sort((a, b) => shareFree(b.stats) - shareFree(a.stats) || String(a.key).localeCompare(String(b.key), "en", { numeric: true }));
