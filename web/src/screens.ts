import * as THREE from "three";
import { assetUrl } from "./assetBase";

/**
 * v4 (user request): the big screens inside the stadium (shell.py _screens, M_Screen) show a 5 s looping feed
 * instead of the static broadcast still: the match (players and ball moving, a running clock) cutting to the
 * aramco / AKQA ad panels. It is drawn into a small canvas at SCREEN.fps, so it costs no download; a real clip
 * at SCREEN.video (muted, looping) replaces it when that file exists. All motion has a period dividing loopS, so
 * the loop is seamless.
 */
export const SCREEN = { w: 512, h: 210, fps: 15, loopS: 5, adFrom: 3.6, fadeS: 0.25, video: assetUrl("brand/screen.mp4") } as const;
/** The part of an ad panel (fraction of its width) that carries the type and logo. */
const AD_CROP = [0.2, 0.82] as const;
export const isScreen = (name: string) => /^M_Screen\b/.test(name);

/** The screen's texture; stadium.ts binds it to M_Screen's emissive map. */
export const screenTexture: { value: THREE.Texture | null } = { value: null };

/** Seconds into the loop and which segment shows: the match, then the ad cut (with a short cross-fade). */
export function screenPhase(t: number) {
  const s = ((t % SCREEN.loopS) + SCREEN.loopS) % SCREEN.loopS;
  const ad = s < SCREEN.adFrom ? 0 : Math.min(1, (s - SCREEN.adFrom) / SCREEN.fadeS) * Math.min(1, (SCREEN.loopS - s) / SCREEN.fadeS);
  return { s, ad };
}

/** Player k's position on the pitch (0..1 each axis) at loop time s: loops exactly every loopS seconds. */
export function playerAt(k: number, s: number) {
  const w = (2 * Math.PI) / SCREEN.loopS, ph = k * 1.7;
  const bx = 0.12 + ((k * 0.137) % 0.76), by = 0.18 + ((k * 0.291) % 0.64);
  return [bx + 0.07 * Math.sin(w * s + ph) + 0.03 * Math.sin(2 * w * s + ph * 2), by + 0.06 * Math.cos(w * s + ph * 1.3)] as const;
}

const PITCH_TOP = 0.2;   // horizon of the perspective pitch (fraction of the screen height)

function project(x: number, y: number, W: number, H: number) {
  const depth = PITCH_TOP + (1 - PITCH_TOP) * y;          // y 0 far .. 1 near
  const half = 0.28 + 0.72 * y;
  return [W * (0.5 + (x - 0.5) * half * 1.1), H * depth] as const;
}

function drawPitch(g: CanvasRenderingContext2D, W: number, H: number) {
  g.fillStyle = "#0b1a2e"; g.fillRect(0, 0, W, H * PITCH_TOP);
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const y0 = PITCH_TOP + (1 - PITCH_TOP) * (i / stripes) ** 1.25, y1 = PITCH_TOP + (1 - PITCH_TOP) * ((i + 1) / stripes) ** 1.25;
    g.fillStyle = i % 2 ? "#2f8f3a" : "#277a31"; g.fillRect(0, H * y0, W, H * (y1 - y0) + 1);
  }
  g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 1.5;
  const line = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = project(x, y, W, H); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); };
  line([[0.05, 0.02], [0.95, 0.02], [0.95, 0.98], [0.05, 0.98], [0.05, 0.02]]);
  line([[0.5, 0.02], [0.5, 0.98]]);
  const c: [number, number][] = [];
  for (let i = 0; i <= 32; i++) { const a = (i / 32) * 2 * Math.PI; c.push([0.5 + 0.09 * Math.cos(a), 0.5 + 0.16 * Math.sin(a)]); }
  line(c);
}

function drawMatch(g: CanvasRenderingContext2D, bg: HTMLCanvasElement, s: number, W: number, H: number) {
  g.drawImage(bg, 0, 0);
  const pts: [number, number, number][] = [];
  for (let k = 0; k < 16; k++) { const [x, y] = playerAt(k, s); pts.push([x, y, k]); }
  pts.sort((a, b) => a[1] - b[1]);                          // far players first
  for (const [x, y, k] of pts) {
    const [px, py] = project(x, y, W, H), r = 2 + 4 * y;
    g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(px, py + 1, r * 0.9, r * 0.35, 0, 0, 2 * Math.PI); g.fill();
    g.fillStyle = k % 2 ? "#f4f6f8" : "#d8282a"; g.fillRect(px - r * 0.45, py - r * 2.4, r * 0.9, r * 1.6);
    g.fillStyle = "#c9956c"; g.beginPath(); g.arc(px, py - r * 2.7, r * 0.4, 0, 2 * Math.PI); g.fill();
  }
  const [bx, by] = playerAt(3, s), [ox, oy] = playerAt(6, s), t = 0.5 + 0.5 * Math.sin((2 * Math.PI * s) / SCREEN.loopS * 2);
  const [px, py] = project(bx + (ox - bx) * t, by + (oy - by) * t, W, H);
  g.fillStyle = "#ffffff"; g.beginPath(); g.arc(px, py - 2, 2.2, 0, 2 * Math.PI); g.fill();
  // scoreboard
  const clock = 67 * 60 + 12 + Math.floor(s);
  g.fillStyle = "rgba(4,16,40,0.88)"; g.fillRect(10, 10, 170, 26);
  g.fillStyle = "#12a14a"; g.fillRect(10, 10, 6, 26);
  g.fillStyle = "#ffffff"; g.font = "700 15px Archivo, sans-serif"; g.textBaseline = "middle";
  g.fillText(`KSA 1 - 0 ARA   ${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}`, 22, 23);
}

/** The feed: a canvas redrawn at SCREEN.fps. `ads` is the LED board atlas (ledBoards.ts: aramco row, then AKQA). */
export function makeScreenFeed(ads: () => CanvasImageSource | null) {
  const { w: W, h: H } = SCREEN;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
  drawPitch(bg.getContext("2d")!, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                                     // glTF UVs, as the glb's own screen image
  screenTexture.value = tex;
  let last = -1, t = 0, cut = 0;
  const draw = () => {
    const { s, ad } = screenPhase(t);
    drawMatch(g, bg, s, W, H);
    const atlas = ads();
    if (ad > 0 && atlas) {
      const row = Math.floor(t / SCREEN.loopS) % 2;      // alternate aramco / AKQA each loop
      cut = row;
      g.globalAlpha = ad;
      const aw = (atlas as HTMLCanvasElement).width, ah = (atlas as HTMLCanvasElement).height / 2;
      g.drawImage(atlas, aw * 0.03, cut * ah, aw * 0.15, ah, 0, 0, W, H);         // background: a logo-free slice, stretched
      const x0 = aw * AD_CROP[0], cw = aw * (AD_CROP[1] - AD_CROP[0]), dh = (ah * W) / cw;
      g.drawImage(atlas, x0, cut * ah, cw, ah, 0, (H - dh) / 2, W, dh);           // its logo area at true aspect
      g.globalAlpha = 1;
    }
    tex.needsUpdate = true;
  };
  const feed = {
    texture: tex as THREE.Texture,
    /** Advances the loop; redraws at most SCREEN.fps times per second. */
    update(dt: number) {
      t += dt;
      const frame = Math.floor(t * SCREEN.fps);
      if (frame !== last && feed.texture === tex) { last = frame; draw(); }
    },
  };
  draw();
  // a real clip, if one is provided, replaces the drawn feed
  fetch(SCREEN.video, { method: "HEAD" }).then((r) => {
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("video")) return;
    const v = document.createElement("video");
    Object.assign(v, { src: SCREEN.video, muted: true, loop: true, playsInline: true, crossOrigin: "anonymous" });
    v.play().then(() => {
      const vt = new THREE.VideoTexture(v);
      vt.colorSpace = THREE.SRGBColorSpace; vt.flipY = false;
      feed.texture = vt; screenTexture.value = vt;
      onSwap?.(vt);
    }, () => {});
  }, () => {});
  let onSwap: ((t: THREE.Texture) => void) | undefined;
  return Object.assign(feed, { onSwap: (f: (t: THREE.Texture) => void) => { onSwap = f; } });
}
