import type { AppState } from "../state";
import type { Section } from "../loader";
import { formatSeat, type SeatDirectory, type SeatRef } from "../seatsData";
import { TIERS, TIER_HEX, type Tier } from "../tiers";
import { HERO_VIEWS } from "../heroViews";
import { Availability, FEATURED_PAIR, STANDS, SeatStatus, byFree, formatPrice, shareFree, standOf, sumStats, type Stand, type Stats } from "../ticketing";
import type { Ticket } from "../tickets";

export interface SidebarHandlers {
  seeView(r: SeatRef, extra?: SeatRef): void; hero(cam: string): void; back(): void; copyLink(): void;
  /** A section opened (fly to it, show its sold seats) or closed (null). */
  section(id: number | null): void;
  extra(r: SeatRef | null): void; buy(): void; resetTickets(): void;
}
const swatch = (t: Tier) => `<span class="swatch" style="background:${TIER_HEX[t]}"></span>`;
const pct = (s: Stats) => `${Math.round(shareFree(s) * 100)}% free`;
const bar = (s: Stats) => `<span class="avail" aria-hidden="true"><i style="width:${(shareFree(s) * 100).toFixed(1)}%"></i></span>`;
const caret = (open: boolean) => `<span class="caret" aria-hidden="true">${open ? "▾" : "▸"}</span>`;
const seatLabel = (r: SeatRef) => `Section ${r.section} · Row ${r.row} · Seat ${r.seat}`;

/**
 * Left sidebar: intro, Overview / Seat view, the seat card (price, companion seat, Buy), My tickets,
 * Buy tickets (featured pair, then Tier > Stand > Section accordions, most free first, with a row / seat
 * picker in the open section), Views worth exploring.
 */
export class Sidebar {
  private openTiers = new Set<Tier>();
  private openStands = new Set<string>();       // "Tier|Stand"
  private openSection: number | null = null;
  private row: number | null = null;            // row shown in the open section's seat picker
  private shown: string | null = null;          // seat view last adopted into the accordions
  private stats = new Map<number, Stats>();
  private tierOf = new Map<number, Tier>();
  private copied = false;
  private state: AppState | null = null;
  constructor(private root: HTMLElement, private dir: SeatDirectory, private sections: Section[], private av: Availability,
              private tickets: () => Ticket[], private on: SidebarHandlers, private heroes = HERO_VIEWS) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    this.refreshStats();
    av.onChange(() => { this.refreshStats(); if (this.state) this.render(this.state); });
    root.classList.add("collapsed");                // bottom sheet starts collapsed on narrow screens (no effect otherwise)
    root.addEventListener("change", (e) => this.onSelect(e.target as HTMLSelectElement));
    root.addEventListener("click", (e) => this.onClick((e.target as HTMLElement).closest("button")));
  }
  refreshStats() { for (const s of this.sections) this.stats.set(Number(s.id), this.av.sectionStats(Number(s.id))); }
  get focusSection() { return this.openSection; }
  /** Confirms "Copy link" in the seat card until the next render. */
  linkCopied() { this.copied = true; if (this.state) this.render(this.state); }
  closeSection() { this.openSection = null; this.row = null; if (this.state) this.render(this.state); }

  private openTo(r: SeatRef) {
    const tier = this.tierOf.get(r.section), s = this.av.section(r.section);
    if (!tier || !s) return;
    this.openTiers.add(tier);
    this.openStands.add(`${tier}|${standOf(s.angle_deg)}`);
    this.openSection = r.section;
    this.row = r.row;
  }
  private firstFreeRow(id: number) {
    const rows = this.dir.rows(id);
    return rows.find((row) => this.dir.seats(id, row).some((seat) => this.av.at({ section: id, row, seat }) === SeatStatus.Free)) ?? rows[0] ?? null;
  }

  render(s: AppState) {
    this.state = s;
    // adopt the shown seat into the accordions only when it changes, so browsing them in seat view is kept
    const key = s.view.kind === "seat" ? formatSeat(s.view.seat) : null;
    if (s.view.kind === "seat" && key !== this.shown) { this.openTo(s.view.seat); this.copied = false; }
    this.shown = key;
    const seat = s.view.kind === "seat" ? s.view.seat : null, extra = s.view.kind === "seat" ? s.view.extra : undefined;
    const collapsed = this.root.classList.contains("collapsed");
    this.root.innerHTML = `
      <button class="sheet-toggle" data-a="sheet" aria-expanded="${!collapsed}">${seat ? seatLabel(seat) : "Buy tickets"} <span aria-hidden="true">${collapsed ? "▴" : "▾"}</span></button>
      <div class="intro"><span class="eyebrow">A place in the stands</span><h1>Take your seat.</h1>
        <p>Pick a seat, see the pitch from it, and buy your ticket.</p></div>
      <div class="seg" role="group" aria-label="View">
        <button data-a="overview" aria-pressed="${!seat}">Overview</button>
        <button data-a="seatview" aria-pressed="${!!seat}" ${seat ? "" : "disabled"}>Seat view</button>
      </div>
      ${seat ? this.card(seat, extra) : ""}
      ${this.myTickets()}
      <section class="shop"><h2>Buy tickets</h2>${this.featured()}${this.tree()}
        <span class="hint">Or click any seat in the stadium</span></section>
      <section><h2>Views worth exploring</h2><ul class="heroes">${this.heroes.map((h) =>
        `<li><button data-hero="${h.cam}"><span class="t">${h.title}</span><span class="k">${swatch(h.tier)}${h.tier}</span></button></li>`).join("")}</ul></section>`;
  }

  private card(seat: SeatRef, extra?: SeatRef) {
    const tier = this.tierOf.get(seat.section) ?? "Lower", st = this.av.at(seat), price = this.av.price(seat);
    let buy = "";
    if (st === SeatStatus.Mine) buy = `<p class="owned">✓ This seat is yours</p>`;
    else if (st === SeatStatus.Sold) buy = `<p class="soldnote">Sold · this seat is no longer available</p>`;
    else {
      const nb = extra ?? this.av.freeNeighbour(seat), both = extra ? price + this.av.price(extra) : price;
      const offer = extra
        ? `<button class="addon on" data-a="extra-off" aria-pressed="true">✓ Seat ${extra.seat} next to it added · ${formatPrice(this.av.price(extra))}<span>Remove</span></button>`
        : nb ? `<button class="addon" data-a="extra-on" data-seat="${nb.seat}" aria-pressed="false">+ Add seat ${nb.seat} next to it · ${formatPrice(this.av.price(nb))}</button>` : "";
      buy = `${offer}<button class="pill buy" data-a="buy">${extra ? `Buy 2 tickets · ${formatPrice(both)}` : `Buy ticket · ${formatPrice(price)}`}</button>`;
    }
    return `
      <section class="card seatcard${st === SeatStatus.Sold ? " is-sold" : ""}" aria-live="polite">
        <span class="eyebrow">Your seat · ${swatch(tier)}${tier} · ${standOf(this.av.section(seat.section)?.angle_deg ?? 0)}</span>
        <dl><div><dt>Section</dt><dd>${seat.section}</dd></div><div><dt>Row</dt><dd>${seat.row}</dd></div><div><dt>Seat</dt><dd>${extra ? `${Math.min(seat.seat, extra.seat)}–${Math.max(seat.seat, extra.seat)}` : seat.seat}</dd></div></dl>
        ${st === SeatStatus.Free ? `<p class="price">${formatPrice(price)} <small>per seat</small></p>` : ""}
        ${buy}
        <div class="actions"><button class="pill ghost plain" data-a="back">Back to overview</button>
          <button class="pill ghost plain" data-a="copy">${this.copied ? "Link copied" : "Copy link"}</button></div>
      </section>`;
  }

  private myTickets() {
    const ts = this.tickets();
    if (!ts.length) return "";
    return `<section class="mine"><h2>My tickets (${ts.length})</h2><ul>${ts.map((t) =>
      `<li><button data-a="mine" data-ref="${formatSeat(t)}"><span>${seatLabel(t)}</span><span class="k">${formatPrice(t.price)}</span></button></li>`).join("")}</ul>
      <button class="link" data-a="reset">Reset demo purchases</button></section>`;
  }

  private featured() {
    const [a, b] = FEATURED_PAIR;
    if (this.av.at(a) !== SeatStatus.Free || this.av.at(b) !== SeatStatus.Free) return "";
    const st = this.stats.get(a.section)!, tier = this.tierOf.get(a.section) ?? "Lower";
    return `<button class="featured" data-a="pair">
      <span class="eyebrow">Last 2 seats together</span>
      <strong>Section ${a.section} · Row ${a.row} · Seats ${a.seat}–${b.seat}</strong>
      <span class="muted">${swatch(tier)}${tier} · ${standOf(this.av.section(a.section)?.angle_deg ?? 0)} · ${Math.round((1 - shareFree(st)) * 100)}% sold. Side by side at midfield, perfect for you and a companion.</span>
      <span class="go">${formatPrice(this.av.price(a) + this.av.price(b))} for both ›</span></button>`;
  }

  private tree() {
    const bySection = (ids: number[]) => ids.map((id) => ({ key: id, stats: this.stats.get(id)! }));
    const tiers = byFree(TIERS.map((tier) => {
      const stands = byFree(STANDS.map((stand) => {
        const ids = this.sections.filter((s) => s.tier === tier && standOf(s.angle_deg) === stand).map((s) => Number(s.id));
        const secs = byFree(bySection(ids));
        return { key: stand as string, stand, secs, stats: sumStats(secs.map((x) => x.stats)) };
      }).filter((x) => x.secs.length));
      return { key: tier as string, tier, stands, stats: sumStats(stands.map((x) => x.stats)) };
    }));
    return `<div class="acc">${tiers.map(({ tier, stands, stats }) => {
      const open = this.openTiers.has(tier);
      return `<div class="acc-tier">
        <button class="acc-h t1" data-a="tier" data-k="${tier}" aria-expanded="${open}">${caret(open)}<span class="nm">${swatch(tier)}${tier}</span>
          <span class="meta">${bar(stats)}<span>${pct(stats)}</span><span class="from">from ${formatPrice(stats.from)}</span></span></button>
        ${open ? stands.map(({ stand, secs, stats: ss }) => this.stand(tier, stand, secs, ss)).join("") : ""}</div>`;
    }).join("")}</div>`;
  }
  private stand(tier: Tier, stand: Stand, secs: { key: number; stats: Stats }[], stats: Stats) {
    const k = `${tier}|${stand}`, open = this.openStands.has(k);
    return `<div class="acc-stand">
      <button class="acc-h t2" data-a="stand" data-k="${k}" aria-expanded="${open}">${caret(open)}<span class="nm">${stand}</span>
        <span class="meta">${bar(stats)}<span>${pct(stats)}</span><span class="from">from ${formatPrice(stats.from)}</span></span></button>
      ${open ? `<ul class="secs">${secs.map(({ key: id, stats: st }) => {
        const cur = this.openSection === id;
        return `<li${cur ? ' class="cur"' : ""}><button class="acc-h t3" data-a="section" data-k="${id}" aria-expanded="${cur}" ${st.free ? "" : 'aria-disabled="true"'}>
          <span class="nm">${id}</span><span class="meta">${bar(st)}<span>${st.free ? pct(st) : "Sold out"}</span><span class="from">from ${formatPrice(st.from)}</span></span></button>
          ${cur ? this.picker(id) : ""}</li>`;
      }).join("")}</ul>` : ""}</div>`;
  }
  private picker(id: number) {
    const rows = this.dir.rows(id), row = this.row !== null && rows.includes(this.row) ? this.row : this.firstFreeRow(id);
    if (row === null) return "";
    const sel = this.state?.view.kind === "seat" ? this.state.view : null;
    const picked = (r: SeatRef) => !!sel && sel.seat.section === r.section && sel.seat.row === r.row && (sel.seat.seat === r.seat || sel.extra?.seat === r.seat);
    const chips = this.dir.seats(id, row).map((seat) => {
      const r = { section: id, row, seat }, st = this.av.at(r), cls = st === SeatStatus.Sold ? "sold" : st === SeatStatus.Mine ? "mine" : "free";
      const title = st === SeatStatus.Sold ? "Sold" : st === SeatStatus.Mine ? "Your seat" : formatPrice(this.av.price(r));
      return `<button class="chip ${cls}${picked(r) ? " sel" : ""}" data-a="chip" data-seat="${seat}" title="Seat ${seat} · ${title}" aria-label="Seat ${seat}, ${title}" ${st === SeatStatus.Sold ? "disabled" : ""}>${seat}</button>`;
    }).join("");
    const opts = rows.map((r) => {
      const free = this.dir.seats(id, r).filter((seat) => this.av.at({ section: id, row: r, seat }) === SeatStatus.Free).length;
      return `<option value="${r}"${r === row ? " selected" : ""}>Row ${r} · ${free ? `${free} free · ${formatPrice(this.av.price({ section: id, row: r, seat: 0 }))}` : "sold out"}</option>`;
    }).join("");
    return `<div class="picker"><label>Row<select data-f="row" data-k="${id}">${opts}</select></label>
      <div class="chips" role="group" aria-label="Seats in row ${row}">${chips}</div>
      <span class="legend"><i class="free"></i>Free <i class="sold"></i>Sold <i class="mine"></i>Yours</span></div>`;
  }

  private onSelect(el: HTMLSelectElement) {
    if (el.dataset.f !== "row" || !this.state) return;
    this.row = Number(el.value);
    this.render(this.state);
    this.root.querySelector<HTMLSelectElement>(`[data-f="row"]`)?.focus();
  }
  private onClick(b: HTMLButtonElement | null) {
    const s = this.state;
    if (!b || !s) return;
    if (b.dataset.hero) return this.on.hero(b.dataset.hero);
    const k = b.dataset.k ?? "", seat = s.view.kind === "seat" ? s.view.seat : null;
    const toggle = <T>(set: Set<T>, v: T) => (set.has(v) ? set.delete(v) : set.add(v));
    switch (b.dataset.a) {
      case "seatview": break;
      case "overview": case "back": if (seat) this.on.back(); break;
      case "copy": this.on.copyLink(); break;
      case "sheet": this.root.classList.toggle("collapsed"); this.render(s); break;
      case "tier": toggle(this.openTiers, k as Tier); this.render(s); break;
      case "stand": toggle(this.openStands, k); this.render(s); break;
      case "section": {
        const id = Number(k), open = this.openSection !== id;
        this.openSection = open ? id : null;
        this.row = open ? this.firstFreeRow(id) : null;
        this.render(s);
        this.on.section(this.openSection);
        break;
      }
      case "chip": {
        const r = { section: this.openSection!, row: this.row ?? this.firstFreeRow(this.openSection!)!, seat: Number(b.dataset.seat) };
        if (this.av.at(r) !== SeatStatus.Sold) this.on.seeView(r);
        break;
      }
      case "pair": this.on.seeView(FEATURED_PAIR[0], FEATURED_PAIR[1]); break;
      case "extra-on": if (seat) this.on.extra({ ...seat, seat: Number(b.dataset.seat) }); break;
      case "extra-off": this.on.extra(null); break;
      case "buy": this.on.buy(); break;
      case "mine": { const [section, row, n] = (b.dataset.ref ?? "").split("-").map(Number); this.on.seeView({ section, row, seat: n }); break; }
      case "reset": this.on.resetTickets(); break;
    }
  }
}
