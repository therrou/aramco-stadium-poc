import type { SeatRef } from "../seatsData";
import { TIER_HEX, type Tier } from "../tiers";

/** Hover card: "SECTION 212 · ROW 10 · SEAT 4", the tier, and the click hint. Positioned in stage pixels. */
export class Tooltip {
  private key = "";
  constructor(private el: HTMLElement) {}
  show(x: number, y: number, r: SeatRef, tier: Tier) {
    const key = `${r.section}-${r.row}-${r.seat}`;
    if (key !== this.key) {
      this.key = key;
      this.el.innerHTML = `<strong>Section ${r.section} · Row ${r.row} · Seat ${r.seat}</strong>
        <span><span class="swatch" style="background:${TIER_HEX[tier]}"></span>${tier} tier</span><em>Click to take this seat ↗</em>`;
    }
    // keep the card inside the stage: flip to the left of the pointer near the right edge
    const stage = this.el.parentElement!, flip = x > stage.clientWidth - 260;
    this.el.style.transform = flip ? "translate(calc(-100% - 14px), -50%)" : "";
    this.el.style.left = `${x}px`;
    this.el.style.top = `${Math.max(30, y)}px`;
    this.el.hidden = false;
  }
  hide() { this.el.hidden = true; this.key = ""; }
}
