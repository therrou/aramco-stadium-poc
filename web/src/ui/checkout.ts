import type { SeatRef } from "../seatsData";
import { TIER_HEX, type Tier } from "../tiers";
import { SERVICE_FEE, formatPrice, rng } from "../ticketing";

export interface CartSeat extends SeatRef { price: number; tier: Tier }
type Step = "review" | "details" | "paying" | "done";
export const PAY_MS = 1200;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A decorative QR-like pattern, stable per seat (no data is encoded). */
function fakeQr(r: SeatRef, n = 21) {
  const rand = rng(r.section * 1_000_003 + r.row * 1009 + r.seat), cells: string[] = [];
  const finder = (x: number, y: number) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => {
    const dx = x - fx, dy = y - fy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  });
  const inFinder = (x: number, y: number) => [[0, 0], [n - 8, 0], [0, n - 8]].some(([fx, fy]) => x >= fx && y >= fy && x < fx + 8 && y < fy + 8);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (inFinder(x, y) ? finder(x, y) : rand() < 0.48) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  return `<svg class="qr" viewBox="-1 -1 ${n + 2} ${n + 2}" aria-hidden="true"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#010532">${cells.join("")}</g></svg>`;
}

/**
 * Symbolic checkout (user request 2026-09-27): Review -> Details (name, email; no card fields, no payment is
 * taken) -> Confirmed with a ticket per seat. Esc or Close cancel before payment.
 */
export class Checkout {
  private step: Step = "review";
  private seats: CartSeat[] = [];
  private name = "";
  private email = "";
  private error = "";
  private opener: HTMLElement | null = null;
  constructor(private el: HTMLElement, private on: { paid(seats: CartSeat[], name: string, email: string): void; closed(bought: boolean): void }) {
    el.addEventListener("click", (e) => {
      if (e.target === el) return this.close();
      const a = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.c;
      if (a === "close") this.close();
      else if (a === "back") this.go(this.step === "details" ? "review" : this.step);
      else if (a === "next") this.go("details");
    });
    el.addEventListener("submit", (e) => { e.preventDefault(); this.pay(); });
    el.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === "name") this.name = t.value; else if (t.name === "email") this.email = t.value;
    });
    // capture phase: Esc closes the checkout without also leaving the seat view
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) { e.stopImmediatePropagation(); this.close(); } }, { capture: true });
  }
  get isOpen() { return !this.el.hidden; }
  open(seats: CartSeat[]) {
    this.seats = seats;
    this.error = "";
    this.opener = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.go("review");
  }
  close() {
    if (this.step === "paying") return;
    const bought = this.step === "done";
    this.el.hidden = true;
    this.opener?.focus?.();
    this.on.closed(bought);
  }
  private totals() {
    const sub = this.seats.reduce((n, s) => n + s.price, 0), fee = Math.round(sub * SERVICE_FEE);
    return { sub, fee, total: sub + fee };
  }
  private pay() {
    if (this.step !== "details") return;
    this.name = this.name.trim(); this.email = this.email.trim();
    this.error = !this.name ? "Please enter your name." : !EMAIL_RE.test(this.email) ? "Please enter a valid email address." : "";
    if (this.error) return this.go("details");
    this.go("paying");
    setTimeout(() => { this.on.paid(this.seats, this.name, this.email); this.go("done"); }, PAY_MS);
  }
  private go(step: Step) {
    this.step = step;
    this.render();
    const focus = this.el.querySelector<HTMLElement>(step === "details" ? (this.error && this.name ? "[name=email]" : "[name=name]") : "[data-focus]");
    focus?.focus();
  }
  private render() {
    const { sub, fee, total } = this.totals(), n = this.seats.length, plural = n > 1 ? "s" : "";
    const steps = (["review", "details", "done"] as const).map((s, k) => {
      const cur = this.step === s || (this.step === "paying" && s === "details");
      return `<li class="${cur ? "cur" : ""}">${k + 1}. ${["Review", "Details", "Confirmed"][k]}</li>`;
    }).join("");
    const lines = this.seats.map((s) => `<li><span><span class="swatch" style="background:${TIER_HEX[s.tier]}"></span>Section ${s.section} · Row ${s.row} · Seat ${s.seat}<small>${s.tier} tier</small></span><b>${formatPrice(s.price)}</b></li>`).join("");
    const summary = `<ul class="lines">${lines}</ul>
      <dl class="totals"><div><dt>Tickets (${n})</dt><dd>${formatPrice(sub)}</dd></div><div><dt>Service fee (${SERVICE_FEE * 100}%)</dt><dd>${formatPrice(fee)}</dd></div>
        <div class="total"><dt>Total</dt><dd>${formatPrice(total)}</dd></div></dl>`;
    let body = "";
    if (this.step === "review") body = `<h2 id="co-title">Review your ticket${plural}</h2>${summary}
      <div class="actions"><button class="pill" data-c="next" data-focus>Continue</button><button class="pill ghost plain" data-c="close">Cancel</button></div>`;
    else if (this.step === "details" || this.step === "paying") {
      const busy = this.step === "paying";
      body = `<h2 id="co-title">Your details</h2>
      <form novalidate>
        <label>Full name<input name="name" autocomplete="name" value="${esc(this.name)}" ${busy ? "disabled" : ""} required /></label>
        <label>Email<input name="email" type="email" autocomplete="email" value="${esc(this.email)}" ${busy ? "disabled" : ""} required /></label>
        ${this.error ? `<p class="err" role="alert">${this.error}</p>` : ""}
        <p class="demo">Demo checkout · no payment is taken. Tickets are saved in this browser only.</p>
        <div class="actions"><button class="pill" type="submit" ${busy ? "disabled" : ""}>${busy ? `<span class="spin" aria-hidden="true"></span>Processing…` : `Pay ${formatPrice(total)}`}</button>
          <button class="pill ghost plain" type="button" data-c="back" ${busy ? "disabled" : ""}>Back</button></div>
      </form>`;
    } else body = `<h2 id="co-title">You're in!</h2>
      <p class="muted">Enjoy the match, ${esc(this.name.split(" ")[0])}. A confirmation would go to ${esc(this.email)}.</p>
      <div class="tickets">${this.seats.map((s) => `<article class="ticket">
        <div><span class="eyebrow">Aramco Stadium · ${s.tier}</span>
          <dl><div><dt>Section</dt><dd>${s.section}</dd></div><div><dt>Row</dt><dd>${s.row}</dd></div><div><dt>Seat</dt><dd>${s.seat}</dd></div></dl>
          <small>${esc(this.name)} · ${formatPrice(s.price)}</small></div>${fakeQr(s)}</article>`).join("")}</div>
      <div class="actions"><button class="pill" data-c="close" data-focus>Back to the stadium</button></div>`;
    this.el.innerHTML = `<div class="card checkout" role="dialog" aria-modal="true" aria-labelledby="co-title">
      <div class="co-head"><ol class="steps">${steps}</ol>${this.step === "paying" ? "" : `<button class="icon x" data-c="close" aria-label="Close">×</button>`}</div>
      ${body}</div>`;
  }
}
