/** Navy header: wordmark (text, no logo file), location eyebrow, and the "About the stadium" card. */
export function renderHeader(root: HTMLElement, seatsTotal: number) {
  root.innerHTML = `<span class="wordmark">Aramco Stadium</span>
    <span class="eyebrow">Al Khobar · Saudi Arabia</span>
    <button class="pill ghost" id="about-open">About the stadium</button>
    <div class="modal" id="about" hidden role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="card">
        <span class="eyebrow">Al Khobar · Saudi Arabia</span>
        <h2 id="about-title">Aramco Stadium</h2>
        <p class="muted">A bowl wrapped in a shell of sails, designed by Populous. This model seats
          ${seatsTotal.toLocaleString("en")} fans across Lower, Club and Upper tiers.
          Section and seat numbers are illustrative.</p>
        <button class="pill plain" id="about-close">Close</button>
      </div>
    </div>`;
  const modal = root.querySelector<HTMLElement>("#about")!, open = root.querySelector<HTMLButtonElement>("#about-open")!;
  const close = () => { modal.hidden = true; open.focus(); };
  open.onclick = () => { modal.hidden = false; root.querySelector<HTMLButtonElement>("#about-close")!.focus(); };
  root.querySelector<HTMLButtonElement>("#about-close")!.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  // capture phase: Esc closes the card without also leaving the seat view
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) { e.stopImmediatePropagation(); close(); } }, { capture: true });
}
