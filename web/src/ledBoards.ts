import * as THREE from "three";

/**
 * Pitch LED advertising boards (user request 2026-09-25): the style of the LED ribbons at the 2026 World Cup
 * (blue and green swooshes, white type), alternating "POWERED BY aramco" and AKQA panels, facing the pitch.
 * The boards are one double-sided plane (scripts/stadium/pitch.py: 0.95 m tall, 5 m off the lines, a loop with
 * a gap at the tunnel); the shader shows the ad on the side facing the pitch and a black, empty back to the
 * stands. The artwork is drawn at runtime into a canvas atlas (one row per panel); every SWAP_S seconds the
 * whole loop steps one panel, with a short wipe, like real boards changing.
 */
/** sat: saturation boost before tone mapping (AgX desaturates bright emitters; real LED boards read saturated). */
export const BOARDS = { bl: 105 / 2 + 5, bw: 68 / 2 + 5, height: 0.95, panel: 12, swapS: 8, wipeS: 0.6, emDay: 0.9, emNight: 0.5, sat: 1.8 } as const;
export type Panel = "aramco" | "akqa";
const PANELS: Panel[] = ["aramco", "akqa"];

export const isLedBoard = (name: string) => /^M_LEDBoard\b/.test(name);

/** Metres along the board loop (counter-clockwise seen from above, from the south-west corner). */
export function boardU(x: number, y: number) {
  const { bl, bw } = BOARDS;
  const d = [Math.abs(y + bw), Math.abs(x - bl), Math.abs(y - bw), Math.abs(x + bl)], side = d.indexOf(Math.min(...d));
  return side === 0 ? x + bl : side === 1 ? 2 * bl + (y + bw) : side === 2 ? 2 * bl + 2 * bw + (bl - x) : 4 * bl + 2 * bw + (bw - y);
}
/** Which ad a panel slot shows at position u (metres) after `shift` swaps. */
export const panelAt = (u: number, shift: number) => PANELS[(((Math.floor(u / BOARDS.panel) + shift) % 2) + 2) % 2];

export const ledUniforms = { uAds: { value: null as THREE.Texture | null }, uAdTime: { value: 0 } };

/**
 * GLSL (needs vWorldPosB, cameraPosition): the ad colour on the pitch side, black on the back. Reading
 * direction: seen from the pitch, u runs to the viewer's left, so the atlas is read with -u.
 */
export const LED_GLSL_BOARDS = /* glsl */ `
uniform sampler2D uAds; uniform float uAdTime;
float boardU( vec3 p, out vec3 outward ) {
  float bl = ${BOARDS.bl.toFixed(2)}, bw = ${BOARDS.bw.toFixed(2)};
  vec4 d = abs( vec4( p.y + bw, p.x - bl, p.y - bw, p.x + bl ) );
  float m = min( min( d.x, d.y ), min( d.z, d.w ) );
  if ( m == d.x ) { outward = vec3( 0, -1, 0 ); return p.x + bl; }
  if ( m == d.y ) { outward = vec3( 1, 0, 0 ); return 2.0 * bl + ( p.y + bw ); }
  if ( m == d.z ) { outward = vec3( 0, 1, 0 ); return 2.0 * bl + 2.0 * bw + ( bl - p.x ); }
  outward = vec3( -1, 0, 0 ); return 4.0 * bl + 2.0 * bw + ( bw - p.y );
}
vec3 adAt( float s, float v, float shift ) {
  float slot = floor( s / ${BOARDS.panel.toFixed(1)} ), row = mod( slot + shift, 2.0 );   // 0 aramco, 1 akqa
  vec2 uv = vec2( fract( s / ${BOARDS.panel.toFixed(1)} ), ( 1.0 - row ) * 0.5 + clamp( v, 0.0, 1.0 ) * 0.5 );
  return texture2D( uAds, uv ).rgb;
}
vec3 ledBoardColor( vec3 pB, out bool facesPitch ) {
  vec3 outward;
  float s = -boardU( pB, outward ), v = pB.z / ${BOARDS.height.toFixed(2)};
  vec3 cameraB = vec3( cameraPosition.x, -cameraPosition.z, cameraPosition.y );
  facesPitch = dot( cameraB - pB, -outward ) > 0.0;
  float cyc = uAdTime / ${BOARDS.swapS.toFixed(1)}, shift = floor( cyc ), t = fract( cyc ) * ${BOARDS.swapS.toFixed(1)};
  // the wipe runs along the loop: each point switches when the wipe front passes it
  float wipe = smoothstep( ${(BOARDS.swapS - BOARDS.wipeS).toFixed(2)}, ${BOARDS.swapS.toFixed(2)}, t + 0.02 * fract( s / ${BOARDS.panel.toFixed(1)} ) * ${BOARDS.wipeS.toFixed(2)} );
  vec3 a = adAt( s, v, shift ), b = adAt( s, v, shift + 1.0 );
  vec3 c = mix( a, b, step( 0.5, wipe ) ) * ( 1.0 - 0.6 * wipe * ( 1.0 - wipe ) * 4.0 );   // brief dip at the change
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( mix( vec3( l ), c, ${BOARDS.sat.toFixed(2)} ), vec3( 0.0 ) );
}
`;

/** Replaces the board's emission: the ad in front, nothing behind; the surface itself is black either way. */
export const LED_EMISSIVE_GLSL = "{ bool fp; vec3 ad = ledBoardColor( vWorldPosB, fp ); totalEmissiveRadiance *= fp ? ad : vec3( 0.0 ); }";

// ---- the artwork (browser only) ----

const BLUE = "#1f8be8", BLUE_DEEP = "#0b5fc4", GREEN = "#2fc43c", GREEN_DEEP = "#12a14a";
const PX_W = 2048, PX_H = 160;   // one 12 m x 0.95 m panel at ~170 px per metre

function swooshes(g: CanvasRenderingContext2D, y0: number, flip: boolean) {
  const W = PX_W, H = PX_H, X = (x: number) => (flip ? W - x : x);
  const bg = g.createLinearGradient(0, y0, W, y0 + H);
  bg.addColorStop(0, BLUE_DEEP); bg.addColorStop(0.5, BLUE); bg.addColorStop(1, BLUE_DEEP);
  g.fillStyle = bg; g.fillRect(0, y0, W, H);
  const band = (x0: number, w: number, bend: number, color: string, alpha: number) => {
    g.globalAlpha = alpha; g.fillStyle = color; g.beginPath();
    g.moveTo(X(x0), y0 + H);
    g.bezierCurveTo(X(x0 + bend), y0 + H * 0.6, X(x0 + bend * 0.3), y0 + H * 0.2, X(x0 + bend * 1.4), y0);
    g.lineTo(X(x0 + bend * 1.4 + w), y0);
    g.bezierCurveTo(X(x0 + bend * 0.3 + w), y0 + H * 0.2, X(x0 + bend + w), y0 + H * 0.6, X(x0 + w), y0 + H);
    g.closePath(); g.fill(); g.globalAlpha = 1;
  };
  band(40, 260, 180, GREEN, 0.95); band(250, 90, 180, GREEN_DEEP, 0.9); band(1180, 340, -160, GREEN, 0.85);
  band(1560, 120, -160, "#7be07f", 0.5); band(1700, 380, 150, GREEN_DEEP, 0.9); band(820, 60, 120, "#58b8ff", 0.5);
}

function drawAramco(g: CanvasRenderingContext2D, y0: number) {
  swooshes(g, y0, false);
  const cy = y0 + PX_H / 2;
  g.fillStyle = "#ffffff"; g.textBaseline = "middle"; g.textAlign = "right";
  g.font = `900 72px "Archivo", sans-serif`;
  g.fillText("POWERED BY", 1010, cy + 4);
  const bx = 1040, bw = 520, bh = 124;
  g.fillStyle = GREEN; g.beginPath(); g.roundRect(bx, cy - bh / 2, bw, bh, 10); g.fill();
  g.fillStyle = "#ffffff"; g.textAlign = "center";
  g.font = `800 96px "Nunito", "Archivo", sans-serif`;
  g.fillText("aramco", bx + bw / 2, cy + 2);
}

function drawAkqa(g: CanvasRenderingContext2D, y0: number) {
  swooshes(g, y0, true);
  g.fillStyle = "#ffffff"; g.textBaseline = "middle"; g.textAlign = "center";
  g.font = `700 128px "Playfair Display", "Times New Roman", serif`;
  g.fillText("AKQA", PX_W / 2, y0 + PX_H / 2 + 8);
}

/** The ad atlas: aramco in the top row, AKQA in the bottom one. Redrawn once the web fonts arrive. */
export function makeAdAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = PX_W; c.height = PX_H * 2;
  const g = c.getContext("2d")!, tex = new THREE.CanvasTexture(c);
  const draw = () => { drawAramco(g, 0); drawAkqa(g, PX_H); tex.needsUpdate = true; };
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  draw();
  Promise.all(['900 72px "Archivo"', '800 96px "Nunito"', '700 128px "Playfair Display"'].map((f) => document.fonts.load(f))).then(draw, () => {});
  return tex;
}
