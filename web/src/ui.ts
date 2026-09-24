import type { AppState } from "./state";
import type { State } from "./loader";

const overlay = () => document.getElementById("overlay")!;

export function showProgress(f: number) {
  overlay().innerHTML = `<div class="progress"><div style="width:${(f * 100).toFixed(1)}%"></div></div>
    <p class="muted">Loading stadium… ${(f * 100).toFixed(0)}%</p>`;
  overlay().hidden = false;
}
export function hideOverlay() { overlay().hidden = true; }
export function showError(file: string, message: string, onRetry: () => void) {
  overlay().innerHTML = `<div class="card"><h2>Couldn't load <code>${file}</code></h2><p class="muted">${message}</p>
    <button id="retry">Retry</button></div>`;
  overlay().hidden = false;
  document.getElementById("retry")!.onclick = onRetry;
}
export function showFatal(message: string) {
  overlay().innerHTML = `<div class="card"><h2>This browser can't show the stadium</h2><p>${message}</p></div>`;
  overlay().hidden = false;
}

export interface PanelInfo { sectionLabel?: string; tier?: string; available?: number; total?: number }
const LABEL: Record<State, string> = { day: "Day", golden: "Golden hour", night: "Night" };

export function renderPanel(s: AppState, info: PanelInfo, on: { lighting(l: State): void; back(): void }) {
  const p = document.getElementById("panel")!;
  const seg = (["day", "golden", "night"] as State[])
    .map((l) => `<button data-l="${l}" aria-pressed="${s.lighting === l}">${LABEL[l]}</button>`).join("");
  const body = s.view.kind === "overview"
    ? `<p class="muted">Click a section to zoom to it.</p>`
    : `<h3>Section ${info.sectionLabel} <span class="muted">· ${info.tier}</span></h3>
       <p>${info.available} of ${info.total} seats available</p>
       <p><button id="back">Back to overview</button></p>`;
  p.innerHTML = `<div class="seg" role="group" aria-label="Time of day">${seg}</div>${body}
    <div class="legend"><span class="sw" style="background:var(--accent)"></span>Available
    <span class="sw" style="background:var(--taken)"></span>Taken
    <span class="sw" style="background:var(--club)"></span>Club tier</div>`;
  p.querySelectorAll<HTMLButtonElement>("[data-l]").forEach((b) => (b.onclick = () => on.lighting(b.dataset.l as State)));
  p.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", on.back);
}
