import type { SeatRef } from "./seatsData";

/** A purchased seat (symbolic checkout), kept in localStorage so it stays taken after a refresh. */
export interface Ticket extends SeatRef { price: number; name: string; email: string; at: number }
export const TICKETS_KEY = "aramco.tickets.v1";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const ls = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

const valid = (t: unknown): t is Ticket => {
  const x = t as Ticket;
  return !!x && [x.section, x.row, x.seat, x.price].every((v) => Number.isFinite(v));
};

export class TicketStore {
  private list: Ticket[];
  constructor(private store: Store | null = ls()) { this.list = this.read(); }
  private read(): Ticket[] {
    try {
      const v = JSON.parse(this.store?.getItem(TICKETS_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter(valid) : [];
    } catch { return []; }
  }
  private write() { try { this.store?.setItem(TICKETS_KEY, JSON.stringify(this.list)); } catch { /* private mode: in-memory only */ } }
  all(): Ticket[] { return [...this.list]; }
  has(r: SeatRef) { return this.list.some((t) => t.section === r.section && t.row === r.row && t.seat === r.seat); }
  add(ts: Ticket[]) { this.list.push(...ts.filter((t) => !this.has(t))); this.write(); }
  clear() { this.list = []; try { this.store?.removeItem(TICKETS_KEY); } catch { /* ignore */ } }
}
