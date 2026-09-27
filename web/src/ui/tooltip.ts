import type { SeatRef } from "../seatsData";
import { TIER_HEX, type Tier } from "../tiers";
import { SeatStatus, formatPrice } from "../ticketing";

/**
 * Hover card: "SECTION 212 · ROW 10 · SEAT 4", the tier, and the ticket state: price and click hint when free,
 * a muted "Sold" card when taken, "Your seat" when bought here. Positioned in stage pixels.
 */
export class Tooltip {
  private key = "";
  constructor(private el: HTMLElement) {}
  show(x: number, y: number, r: SeatRef, tier: Tier, status: SeatStatus = SeatStatus.Free, price = 0) {
    const key = `${r.section}-${r.row}-${r.seat}-${status}`;
    if (key !== this.key) {
      this.key = key;
      const head = `<strong>Section ${r.section} · Row ${r.row} · Seat ${r.seat}</strong>`;
      const tierLine = `<span><span class="swatch" style="background:${TIER_HEX[tier]}"></span>${tier} tier</span>`;
      this.el.classList.toggle("sold", status === SeatStatus.Sold);
      this.el.classList.toggle("mine", status === SeatStatus.Mine);
      this.el.innerHTML = status === SeatStatus.Sold
        ? `${head}<b class="tag">Sold</b><span class="msg">This seat is no longer available.</span>`
        : status === SeatStatus.Mine
          ? `${head}<b class="tag">Your seat · purchased</b><em>Click to see your view ↗</em>`
          : `${head}${tierLine}<b class="price">${formatPrice(price)}</b><em>Click to view &amp; buy ↗</em>`;
    }
    // keep the card inside the stage: flip to the left of the pointer near the right edge
    const stage = this.el.parentElement!, flip = x > stage.clientWidth - 260;
    this.el.style.transform = flip ? "translate(calc(-100% - 14px), -50%)" : "";
    this.el.style.left = `${x}px`;
    this.el.style.top = `${Math.max(30, y)}px`;
    this.el.hidden = false;
  }
  /** A click on a sold seat: a short shake says "not available" without moving the camera. */
  nudge() {
    this.el.classList.remove("shake");
    void this.el.offsetWidth;
    this.el.classList.add("shake");
  }
  hide() { this.el.hidden = true; this.key = ""; }
}
