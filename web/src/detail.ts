/**
 * Spec v3 part 2: surface detail computed in the shader (no textures, nothing added to the asset budget).
 * The lightmaps keep only light; colour and fine detail come from here. All positions are Blender world
 * coordinates (vWorldPosB, metres); pixel footprints come from fwidth, so detail below a pixel fades to its
 * average instead of shimmering.
 */

/**
 * D3: uniform B-spline (bicubic) lightmap sampling with 4 bilinear taps (GPU Gems 2, ch. 20). Bilinear showed
 * every lightmap texel as a hard-edged square (0.5 m on the pitch, ~6.5 m on the far site).
 */
export const BICUBIC_GLSL = /* glsl */ `
vec4 texBicubic( sampler2D t, vec2 uv ) {
  vec2 size = vec2( textureSize( t, 0 ) ), st = uv * size - 0.5, i = floor( st ), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = ( 1.0 - 3.0 * f + 3.0 * f2 - f3 ) / 6.0, w1 = ( 4.0 - 6.0 * f2 + 3.0 * f3 ) / 6.0;
  vec2 w2 = ( 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 ) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = ( w1 / g0 ) - 1.0 + i + 0.5, h1 = ( w3 / g1 ) + 1.0 + i + 0.5;
  vec4 a = texture2D( t, vec2( h0.x, h0.y ) / size ), b = texture2D( t, vec2( h1.x, h0.y ) / size );
  vec4 c = texture2D( t, vec2( h0.x, h1.y ) / size ), d = texture2D( t, vec2( h1.x, h1.y ) / size );
  return g0.y * ( g0.x * a + g1.x * b ) + g1.y * ( g0.x * c + g1.x * d );
}
`;

/** Value noise and fbm shared by the detail shaders; octaves finer than ~2 px fade out. */
const NOISE_GLSL = /* glsl */ `
float dHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float dNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ), u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( dHash( i ), dHash( i + vec3( 1, 0, 0 ) ), u.x ), mix( dHash( i + vec3( 0, 1, 0 ) ), dHash( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
              mix( mix( dHash( i + vec3( 0, 0, 1 ) ), dHash( i + vec3( 1, 0, 1 ) ), u.x ), mix( dHash( i + vec3( 0, 1, 1 ) ), dHash( i + vec3( 1, 1, 1 ) ), u.x ), u.y ), u.z );
}
// fbm in [0, 1], centred on 0.5 like Blender's Noise Texture; px is the pixel footprint in metres
float dFbm( vec3 p, float scale, int octaves, float px ) {
  float a = 0.5, s = 0.0, n = 0.0, f = scale;
  for ( int o = 0; o < 8; o++ ) {
    if ( o >= octaves ) break;
    float keep = 1.0 - smoothstep( 0.25, 0.5, f * px );
    s += a * mix( 0.5, dNoise( p * f + float( o ) * 7.13 ), keep ); n += a; a *= 0.5; f *= 2.0;
  }
  return s / n;
}
`;

/** D1: Blender's pitch grass (scripts/stadium/pitch.py _grass_material), field 105 m, 20 bands. */
export const GRASS = { band: 105 / 20, dark: [0.045, 0.16, 0.035], light: [0.07, 0.23, 0.05], noiseScale: 0.35, mix: 0.35 } as const;
/** Band index of Blender's floor(x / band) mod 2, absolute (Blender's modulo keeps the sign). */
export const grassBand = (x: number) => Math.abs(Math.floor(x / GRASS.band) % 2);
const v3 = (c: readonly number[]) => `vec3( ${c.map((v) => v.toFixed(3)).join(", ")} )`;
export const GRASS_GLSL = NOISE_GLSL + /* glsl */ `
vec3 grassAlbedo( vec3 pB ) {
  float px = max( length( fwidth( pB ) ), 1e-4 );
  float band = abs( mod( floor( pB.x / ${GRASS.band.toFixed(4)} ), 2.0 ) );
  // Blender blends the band edge over one sample; a 3 cm soft edge keeps it crisp but antialiased
  float e = abs( fract( pB.x / ${GRASS.band.toFixed(4)} + 0.5 ) - 0.5 ) * ${GRASS.band.toFixed(4)};
  vec3 base = mix( ${v3(GRASS.dark)}, ${v3(GRASS.light)}, band );
  base = mix( mix( ${v3(GRASS.dark)}, ${v3(GRASS.light)}, 0.5 ), base, smoothstep( 0.0, max( 0.03, px ), e ) );
  vec3 noise = vec3( dFbm( pB, ${GRASS.noiseScale.toFixed(2)}, 8, px ), dFbm( pB + 11.7, ${GRASS.noiseScale.toFixed(2)}, 8, px ), dFbm( pB + 23.1, ${GRASS.noiseScale.toFixed(2)}, 8, px ) );
  vec3 c = base * mix( vec3( 1.0 ), noise, ${GRASS.mix.toFixed(2)} );   // Mix MULTIPLY, factor 0.35
  // blade grain (Blender's fine bump at scale 400, here as albedo grain), gone once a blade is sub-pixel
  float grain = dNoise( pB * vec3( 260.0, 260.0, 60.0 ) );
  return c * mix( 1.0, 0.82 + 0.36 * grain, 1.0 - smoothstep( 0.002, 0.008, px ) );
}
`;

/** D2: goal net cords (square mesh). */
export const NET = { cell: 0.12, cord: 0.015, color: 0.95 } as const;
/** Box-filtered coverage of one line family at distance d from its line, over a pixel of px metres. */
const lineCov = (d: number, px: number) => Math.min(1, Math.max(0, (NET.cord / 2 - d) / Math.max(px, 1e-6) + 0.5));
/** JS twin of netCoverage: sharp cords near, their area share (1 - (1 - cord/cell)^2) once cells are sub-pixel. */
export function netCoverage(x: number, y: number, px: number) {
  const dist = (v: number) => Math.abs(((v / NET.cell + 0.5) % 1 + 1) % 1 - 0.5) * NET.cell;
  const sharp = 1 - (1 - lineCov(dist(x), px)) * (1 - lineCov(dist(y), px));
  const share = 1 - (1 - NET.cord / NET.cell) ** 2;
  const t = Math.min(1, Math.max(0, (px - 0.3 * NET.cell) / (0.5 * NET.cell)));
  const fade = t * t * (3 - 2 * t);
  return sharp + (share - sharp) * fade;
}
export const NET_GLSL = /* glsl */ `
float netCoverage( vec2 p ) {
  float px = max( length( fwidth( p ) ), 1e-5 );
  vec2 d = abs( fract( p / ${NET.cell.toFixed(3)} + 0.5 ) - 0.5 ) * ${NET.cell.toFixed(3)};
  vec2 l = clamp( ( ${(NET.cord / 2).toFixed(4)} - d ) / px + 0.5, 0.0, 1.0 );
  float sharp = 1.0 - ( 1.0 - l.x ) * ( 1.0 - l.y );
  float share = ${(1 - (1 - NET.cord / NET.cell) ** 2).toFixed(5)};
  return mix( sharp, share, smoothstep( ${(0.3 * NET.cell).toFixed(4)}, ${(0.8 * NET.cell).toFixed(4)}, px ) );
}
// the net planes are axis-aligned: pick the two axes across the plane from its normal
vec2 netPlane( vec3 pB, vec3 nB ) {
  vec3 a = abs( nB );
  return a.x > a.y && a.x > a.z ? pB.yz : a.y > a.z ? pB.xz : pB.xy;
}
`;

/**
 * D8: stand concrete (treads, risers, nosings, soffits): world-space mottling and fine speckle, triplanar
 * by the normal, as albedo modulation around 1 (the Blender colours stay the mean).
 */
export const CONCRETE_GLSL = NOISE_GLSL + /* glsl */ `
vec3 concreteDetail( vec3 pB, vec3 nB ) {
  float px = max( length( fwidth( pB ) ), 1e-4 );
  vec3 w = pow( abs( nB ), vec3( 4.0 ) ); w /= w.x + w.y + w.z;
  float m = w.x * dFbm( pB.yzx, 0.7, 5, px ) + w.y * dFbm( pB.xzy, 0.7, 5, px ) + w.z * dFbm( pB, 0.7, 5, px );
  float s = w.x * dNoise( pB.yzx * 90.0 ) + w.y * dNoise( pB.xzy * 90.0 ) + w.z * dNoise( pB * 90.0 );
  float speck = mix( 0.5, s, 1.0 - smoothstep( 0.004, 0.012, px ) );
  return vec3( 0.84 + 0.3 * m ) * ( 0.93 + 0.14 * speck );
}
`;

/**
 * D5: the site's ground (lawn, sand, paving, plaza, asphalt). The far-site lightmap is ~6.5 m per texel,
 * so world-space mottling at ~12 m and ~2 m plus a fine grain break up its smooth blocks (albedo modulation
 * around 1). At night the lit concourse glass (M_ConcourseGlass, emission 2.5 x n) lights the plaza around the
 * podium; the night bake left it dark where Cycles shows it bright, so that spill is added: irradiance
 * PODIUM_GLOW.e at the shell's outline, fading with an e-fold of PODIUM_GLOW.decay metres outward.
 */
export const PODIUM_GLOW = { e: 1.4, decay: 40, color: [1.0, 0.86, 0.66] } as const;
/** Metres outside the shell outline per unit of shell superellipse radius (SHELL_A/B ~ 138/121 m). */
const OUTLINE_M = 130;
export const podiumGlow = (shellRadius: number) =>
  shellRadius < 1 ? 0 : PODIUM_GLOW.e * Math.exp(-((shellRadius - 1) * OUTLINE_M) / PODIUM_GLOW.decay);
export const GROUND_GLSL = NOISE_GLSL + /* glsl */ `
vec3 groundDetail( vec3 pB ) {
  float px = max( length( fwidth( pB ) ), 1e-4 );
  vec3 p = vec3( pB.xy, 0.0 );
  float m = dFbm( p, 0.08, 3, px ) * 0.6 + dFbm( p, 0.5, 4, px ) * 0.4;
  float grain = mix( 0.5, dNoise( p * 45.0 ), 1.0 - smoothstep( 0.006, 0.02, px ) );
  return vec3( 0.8 + 0.4 * m ) * ( 0.94 + 0.12 * grain );
}
// anti-tiling: a second lookup of the same texture, rotated 37 degrees and rescaled, blended in by a large noise
vec2 antiTileUv( vec2 uv ) { const float c = 0.7986, s = 0.6018; return mat2( c, s, -s, c ) * uv * 0.61 + vec2( 0.31, 0.17 ); }
vec3 podiumGlow( vec3 pB ) {
  float S = pow( pow( abs( pB.x / 138.0 ), 2.25 ) + pow( abs( pB.y / 121.0 ), 2.25 ), 1.0 / 2.25 );
  float g = S < 1.0 ? 0.0 : ${PODIUM_GLOW.e.toFixed(3)} * exp( -( S - 1.0 ) * ${OUTLINE_M.toFixed(1)} / ${PODIUM_GLOW.decay.toFixed(1)} );
  return g * vec3( ${PODIUM_GLOW.color.map((v) => v.toFixed(2)).join(", ")} );
}
`;

/** D5: after map_fragment on ground materials; the tiled Poly Haven textures showed a regular repeat from above. */
export const GROUND_MAP_GLSL = /* glsl */ `
#ifdef USE_MAP
{
  vec4 t2 = texture2D( map, antiTileUv( vMapUv ) );
  float k = smoothstep( 0.42, 0.58, dFbm( vec3( vWorldPosB.xy, 0.0 ), 0.05, 2, 0.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * t2.rgb, k );
}
#endif
`;

/**
 * v4 (user: the city read as plain rectangles by day): procedural facades on the city blocks, no download.
 * Vertical faces get a window grid (floors CITY.floor m, bays CITY.bay m) with dark glass, a lighter band per
 * floor slab and a tint per block; roofs get a parapet ring and mottling. Once a pixel spans about a floor
 * the grid fades to its mean, so distant blocks do not shimmer. cityWindow() also masks the night emission,
 * so the baked lit-window light lands inside the windows.
 */
export const CITY = { floor: 3.3, bay: 3.8, glass: 0.42, lit: 0.28, gain: 2.6 } as const;
export const CITY_GLSL = NOISE_GLSL + /* glsl */ `
float cityWindow( vec3 pB, vec3 nB ) {
  if ( abs( nB.z ) > 0.5 ) return 0.0;
  float along = abs( nB.x ) > abs( nB.y ) ? pB.y : pB.x;
  vec2 g = vec2( along / ${CITY.bay.toFixed(2)}, pB.z / ${CITY.floor.toFixed(2)} );
  vec2 f = fract( g ), w = max( fwidth( g ), vec2( 1e-4 ) );
  float wx = smoothstep( 0.16 - w.x, 0.16 + w.x, f.x ) * ( 1.0 - smoothstep( 0.84 - w.x, 0.84 + w.x, f.x ) );
  float wy = smoothstep( 0.30 - w.y, 0.30 + w.y, f.y ) * ( 1.0 - smoothstep( 0.86 - w.y, 0.86 + w.y, f.y ) );
  float fade = 1.0 - smoothstep( 0.35, 0.9, max( w.x, w.y ) );
  float ground = step( ${CITY.floor.toFixed(2)}, pB.z );            // no windows on the plinth floor band
  return mix( 0.68 * 0.56, wx * wy, fade ) * ground;
}
/**
 * User 2026-09-28: the baked window light read as random blobs across the facade (its map is far coarser
 * than the grid). Night light is now per window: CITY.lit of the windows are on, each with its own warm or
 * cool white and brightness, framed by cityWindow's mask; far away it fades to the mean, like the grid.
 */
vec3 cityLights( vec3 pB, vec3 nB ) {
  if ( abs( nB.z ) > 0.5 ) return vec3( 0.0 );
  float face = abs( nB.x ) > abs( nB.y ) ? ( nB.x > 0.0 ? 1.0 : 2.0 ) : ( nB.y > 0.0 ? 3.0 : 4.0 );
  float along = abs( nB.x ) > abs( nB.y ) ? pB.y : pB.x;
  vec2 cell = floor( vec2( along / ${CITY.bay.toFixed(2)}, pB.z / ${CITY.floor.toFixed(2)} ) );
  float across = abs( nB.x ) > abs( nB.y ) ? pB.x : pB.y;               // separates parallel facades
  float h = dHash( vec3( cell, face * 17.0 + floor( across ) ) );
  float on = step( h, ${CITY.lit.toFixed(2)} );
  float k = h / ${CITY.lit.toFixed(2)};                                  // 0-1 among the lit ones
  vec3 col = mix( vec3( 1.0, 0.78, 0.52 ), vec3( 0.85, 0.9, 1.0 ), step( 0.7, k ) ) * ( 0.6 + 0.4 * fract( k * 7.3 ) );
  float win = cityWindow( pB, nB );
  vec2 w = fwidth( vec2( along / ${CITY.bay.toFixed(2)}, pB.z / ${CITY.floor.toFixed(2)} ) );
  float fade = 1.0 - smoothstep( 0.35, 0.9, max( w.x, w.y ) );
  vec3 mean = vec3( 1.0, 0.85, 0.68 ) * 0.8 * ${CITY.lit.toFixed(2)};
  return mix( mean, col * on, fade ) * win;
}
vec3 cityFacade( vec3 pB, vec3 nB ) {
  vec2 blk = floor( pB.xy / 18.0 );
  float tint = 0.9 + 0.2 * dHash( vec3( blk, 7.0 ) );
  if ( abs( nB.z ) > 0.5 ) {                                          // roof: mottled, darker service patches
    float m = dNoise( vec3( pB.xy * 0.35, 1.0 ) );
    return vec3( tint * ( 0.86 + 0.14 * m ) );
  }
  float win = cityWindow( pB, nB );
  vec3 glass = vec3( 0.55, 0.62, 0.7 ) * ${CITY.glass.toFixed(2)};
  return mix( vec3( tint ), glass, win );
}
`;

export type Detail = "grass" | "net" | "concrete" | "ground" | "slab" | "city";
/**
 * v4: the granite-slab paving (M_Paving, M_Plaza) is a regular running bond, so it skips the anti-tiling second
 * lookup (the rotated copy broke the joints into patches) and takes half the ground mottling; the podium's
 * night glow still applies.
 */
const ROUTES: [RegExp, Detail][] = [
  [/^M_(Paving|Plaza)\b/, "slab"],
  [/^M_(Lawn|Sand|Asphalt)\b/, "ground"],
  [/^M_Building\d/, "city"],
  [/^M_Grass\b/, "grass"],
  [/^M_Net\b/, "net"],
  [/^M_(Concrete|ConcreteRiser|StepNosing|Soffit)\b/, "concrete"],
];
export const detailFor = (name: string) => ROUTES.find(([re]) => re.test(name))?.[1];
