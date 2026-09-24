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

export function exposeViewerHooks(hooks: object) { (window as any).__viewer = hooks; }
