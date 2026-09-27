import type { AppState } from "../state";
import type { State } from "../loader";
import { MODE_CAMERAS } from "../heroViews";

export interface ControlHandlers { lighting(l: State): void; zoom(f: number): void; reset(): void; fullscreen(): void; camera(cam: string): void; autoOrbit(on: boolean): void }
const LABEL: Record<State, string> = { day: "Day", golden: "Golden hour", night: "Night" };
/** Lighting menu: Day hidden for now (user request 2026-09-27); still listed when a link opened it. */
const MENU: State[] = ["golden", "night"];
export const ZOOM_STEP = 0.7;

/** Viewport overlays: title, lighting dropdown, zoom/reset/fullscreen, mode bar and hints. */
export class Controls {
  private lastCam: string | null = null;
  constructor(private root: HTMLElement, private on: ControlHandlers) {}
  /** Forget the pressed mode-bar camera (the user flew elsewhere). */
  clearCamera() { this.lastCam = null; }
  render(s: AppState) {
    const seat = s.view.kind === "seat", noOrbit = seat || s.inside;
    const menu = MENU.includes(s.lighting) ? MENU : [s.lighting, ...MENU];
    this.root.innerHTML = `
      <div class="ov ov-title"><h2>Aramco Stadium.</h2><span class="eyebrow">Al Khobar · Saudi Arabia</span></div>
      <label class="ov ov-light"><span class="visually-hidden">Lighting</span><select>${menu.map((l) =>
        `<option value="${l}"${l === s.lighting ? " selected" : ""}>${LABEL[l]}</option>`).join("")}</select></label>
      <div class="ov ov-zoom">
        <button class="icon" data-z="in" aria-label="Zoom in" title="Zoom in">+</button>
        <button class="icon" data-z="out" aria-label="Zoom out" title="Zoom out">−</button>
        <button class="icon" data-z="reset" aria-label="Reset view" title="Reset view">⟲</button>
        <button class="icon" data-z="full" aria-label="Fullscreen" title="Fullscreen">⛶</button>
      </div>
      <div class="ov ov-bar">
        <div class="bar" role="group" aria-label="Camera">${MODE_CAMERAS.map((m) =>
          `<button data-cam="${m.cam}" aria-pressed="${!seat && !s.autoOrbit && this.lastCam === m.cam}">${m.label}</button>`).join("")}
          <button data-orbit aria-pressed="${s.autoOrbit}" ${noOrbit ? "disabled" : ""}${s.inside && !seat ? ' title="Auto orbit is available outside the stadium"' : ""}>Auto orbit</button></div>
        <div class="hints">Drag to ${seat ? "look around" : "orbit"} · Scroll to zoom · Click a seat</div>
      </div>`;
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    (q("select") as HTMLSelectElement).onchange = (e) => this.on.lighting((e.target as HTMLSelectElement).value as State);
    q('[data-z="in"]').onclick = () => this.on.zoom(ZOOM_STEP);
    q('[data-z="out"]').onclick = () => this.on.zoom(1 / ZOOM_STEP);
    q('[data-z="reset"]').onclick = () => this.on.reset();
    q('[data-z="full"]').onclick = () => this.on.fullscreen();
    this.root.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) => (b.onclick = () => { this.lastCam = b.dataset.cam!; this.on.camera(b.dataset.cam!); }));
    q("[data-orbit]").onclick = () => this.on.autoOrbit(!s.autoOrbit);
  }
}
