import Stats from "stats.js";

export class Perf {
  private frames: number[] = [];
  private t0 = 0;
  stats: Stats | null = null;
  constructor(show: boolean) {
    if (show) { this.stats = new Stats(); document.body.appendChild(this.stats.dom); }
  }
  begin() { this.t0 = performance.now(); this.stats?.begin(); }
  end() {
    this.stats?.end();
    const now = performance.now();
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 5000) this.frames.shift();
  }
  /** Mean fps over the last 5 s. */
  get fps() { const f = this.frames; return f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0; }
}

/**
 * Adaptive resolution (2026-09-28): a GPU that cannot hold ~40 fps at the start pixel ratio steps down
 * (2 -> 1.5 -> 1), judged on the mean frame interval over a window once loading hitches have passed.
 * It never steps back up, so the view does not oscillate between sharp and soft.
 */
export const DPR = { steps: [2, 1.5, 1], slowMs: 25, windowS: 3, graceS: 4 } as const;
export class DprGovernor {
  private t = 0; private n = 0; private sum = 0;
  constructor(public dpr: number) {}
  /** Feed each frame's interval (s); returns the new pixel ratio when it should drop, else null. */
  sample(dt: number): number | null {
    this.t += dt;
    if (this.t < DPR.graceS) return null;
    this.n++; this.sum += dt;
    if (this.sum < DPR.windowS) return null;
    const meanMs = (this.sum / this.n) * 1000;
    this.n = 0; this.sum = 0;
    const next = DPR.steps.find((s) => s < this.dpr);
    if (meanMs <= DPR.slowMs || next === undefined) return null;
    this.t = DPR.graceS - 1;          // a second of settling after the resize before judging again
    return (this.dpr = next);
  }
}

export function exposeViewerHooks(hooks: object) { (window as any).__viewer = hooks; }
