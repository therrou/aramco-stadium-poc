import type { SeatTable } from "./seatsData";
export type Avail = 0 | 1;

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Seeded mock: each section gets its own fill rate around 35 %, and taken seats come in runs
 *  (a two-state Markov chain whose stationary share equals the section rate, mean run ≈ RUN seats). */
export function mockAvailability(t: SeatTable, idx: Map<number, { start: number; end: number }>, seed = 2026): Uint8Array {
  const rnd = mulberry32(seed), out = new Uint8Array(t.count), RUN = 8;
  for (const { start, end } of idx.values()) {
    const rate = Math.min(0.85, Math.max(0.05, 0.35 + (rnd() - 0.5) * 0.6));
    const pTake = rate / RUN, pFree = (1 - rate) / RUN;
    let s = rnd() < rate ? 1 : 0;
    for (let i = start; i < end; i++) {
      out[i] = s;
      if (rnd() < (s ? pFree : pTake)) s ^= 1;
    }
  }
  return out;
}
