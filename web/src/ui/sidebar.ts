import type { AppState } from "../state";
import type { Section } from "../loader";
import { formatSeat, sectionsOfTier, type SeatDirectory, type SeatRef } from "../seatsData";
import { TIERS, TIER_HEX, type Tier } from "../tiers";
import { HERO_VIEWS } from "../heroViews";

export interface SidebarHandlers { seeView(r: SeatRef): void; hero(cam: string): void; back(): void; copyLink(): void }
const opts = (vals: (number | string)[], sel: number | string) =>
  vals.map((v) => `<option value="${v}"${v === sel ? " selected" : ""}>${v}</option>`).join("");
const swatch = (t: Tier) => `<span class="swatch" style="background:${TIER_HEX[t]}"></span>`;

/** Left sidebar: intro, Overview / Seat view, the seat card, Find your seat, Views worth exploring. */
export class Sidebar {
  private tier: Tier = "Lower";
  private pick: SeatRef | null = null;          // the finder's current choice
  private shown: string | null = null;          // seat view last adopted into the finder
  private tierOf = new Map<number, Tier>();
  private copied = false;
  private state: AppState | null = null;
  constructor(private root: HTMLElement, private dir: SeatDirectory, private sections: Section[], private on: SidebarHandlers,
              private heroes = HERO_VIEWS) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    this.choose(this.tier);
    root.classList.add("collapsed");                // bottom sheet starts collapsed on narrow screens (no effect otherwise)
    root.addEventListener("change", (e) => this.onSelect(e.target as HTMLSelectElement));
    root.addEventListener("click", (e) => this.onClick((e.target as HTMLElement).closest("button")));
  }
  /** First section / row / seat of a tier, or of the given section and row. */
  private choose(tier: Tier, section?: number, row?: number) {
    const secs = sectionsOfTier(this.sections, tier);
    const sec = section !== undefined && secs.includes(section) ? section : secs[0];
    const rows = sec === undefined ? [] : this.dir.rows(sec), r = row !== undefined && rows.includes(row) ? row : rows[0];
    this.tier = tier;
    this.pick = sec !== undefined && r !== undefined ? { section: sec, row: r, seat: this.dir.seats(sec, r)[0] } : null;
  }
  /** Confirms "Copy link" in the seat card until the next render. */
  linkCopied() { this.copied = true; if (this.state) this.render(this.state); }
  render(s: AppState) {
    this.state = s;
    // adopt the shown seat into the finder only when it changes, so browsing the finder in seat view is kept
    const key = s.view.kind === "seat" ? formatSeat(s.view.seat) : null;
    if (s.view.kind === "seat" && key !== this.shown) { this.tier = this.tierOf.get(s.view.seat.section) ?? this.tier; this.pick = s.view.seat; this.copied = false; }
    this.shown = key;
    const seat = s.view.kind === "seat" ? s.view.seat : null, p = this.pick, seatTier = seat ? this.tierOf.get(seat.section) ?? "Lower" : null;
    const finder = p ? `
      <label>Tier<select data-f="tier">${TIERS.map((t) => `<option value="${t}"${t === this.tier ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="grid3">
        <label>Section<select data-f="section">${opts(sectionsOfTier(this.sections, this.tier), p.section)}</select></label>
        <label>Row<select data-f="row">${opts(this.dir.rows(p.section), p.row)}</select></label>
        <label>Seat<select data-f="seat">${opts(this.dir.seats(p.section, p.row), p.seat)}</select></label>
      </div>` : `<p class="muted">No seats loaded.</p>`;
    const card = seat && seatTier ? `
      <section class="card seatcard" aria-live="polite">
        <span class="eyebrow">Your seat · ${swatch(seatTier)}${seatTier}</span>
        <dl><div><dt>Section</dt><dd>${seat.section}</dd></div><div><dt>Row</dt><dd>${seat.row}</dd></div><div><dt>Seat</dt><dd>${seat.seat}</dd></div></dl>
        <div class="actions"><button class="pill" data-a="back">Back to overview</button>
          <button class="pill ghost plain" data-a="copy">${this.copied ? "Link copied" : "Copy link"}</button></div>
      </section>` : "";
    const collapsed = this.root.classList.contains("collapsed");
    this.root.innerHTML = `
      <button class="sheet-toggle" data-a="sheet" aria-expanded="${!collapsed}">${seat ? `Section ${seat.section} · Row ${seat.row} · Seat ${seat.seat}` : "Take your seat"} <span aria-hidden="true">${collapsed ? "▴" : "▾"}</span></button>
      <div class="intro"><span class="eyebrow">A place in the stands</span><h1>Take your seat.</h1>
        <p>Pick a seat and see the pitch from it, or explore the stadium around you.</p></div>
      <div class="seg" role="group" aria-label="View">
        <button data-a="overview" aria-pressed="${!seat}">Overview</button>
        <button data-a="seatview" aria-pressed="${!!seat}" ${seat || p ? "" : "disabled"}>Seat view</button>
      </div>
      ${card}
      <section class="finder"><h2>Find your seat</h2>${finder}
        <button class="pill" data-a="see" ${p ? "" : "disabled"}>See the view</button>
        <span class="hint">Or click any seat in the stadium</span></section>
      <section><h2>Views worth exploring</h2><ul class="heroes">${this.heroes.map((h) =>
        `<li><button data-hero="${h.cam}"><span class="t">${h.title}</span><span class="k">${swatch(h.tier)}${h.tier}</span></button></li>`).join("")}</ul></section>`;
  }
  private onSelect(el: HTMLSelectElement) {
    const val = (f: string) => this.root.querySelector<HTMLSelectElement>(`[data-f="${f}"]`)!.value;
    const f = el.dataset.f;
    if (!f || !this.state) return;
    if (f === "tier") this.choose(val("tier") as Tier);
    else if (f === "section") this.choose(this.tier, Number(val("section")));
    else if (f === "row") this.choose(this.tier, Number(val("section")), Number(val("row")));
    else this.pick = { section: Number(val("section")), row: Number(val("row")), seat: Number(val("seat")) };
    this.render(this.state);                          // new option lists; the 3D view only changes on "See the view"
    this.root.querySelector<HTMLSelectElement>(`[data-f="${f}"]`)?.focus();
  }
  private onClick(b: HTMLButtonElement | null) {
    const s = this.state;
    if (!b || !s) return;
    if (b.dataset.hero) return this.on.hero(b.dataset.hero);
    switch (b.dataset.a) {
      case "see": if (this.pick) this.on.seeView(this.pick); break;
      case "seatview": if (s.view.kind !== "seat" && this.pick) this.on.seeView(this.pick); break;
      case "overview": case "back": if (s.view.kind === "seat") this.on.back(); break;
      case "copy": this.on.copyLink(); break;
      case "sheet": this.root.classList.toggle("collapsed"); this.render(s); break;
    }
  }
}
