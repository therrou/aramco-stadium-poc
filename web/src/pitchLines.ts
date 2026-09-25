import * as THREE from "three";

/**
 * Final review 4 (pitch "halfway dark line"): the line markings (M_LineWhite, 6-12 cm wide) get
 * lightmap charts far below one texel in the 256 px pitch atlas, so each line samples whatever texel
 * its sliver lands on; the halfway line, goal lines and box fronts land on padding and read as dark
 * lines. The lines lie 1 cm above the grass, whose lightmap charts are planar (four quadrant quads,
 * seams at x = 0 and y = 0). Flat line fragments therefore sample the grass lightmap at their own
 * position instead: per fragment, so a line straddling a chart seam (the halfway line sits on x = 0)
 * picks the right chart on each side. No rebake. v3: the goal posts (same material) use the grass lighting at their footprint too: their own
 * baked texels came out black (12 cm tubes).
 */
export const MAX_CHARTS = 4;

/** Affine chart: uv = (dot(u, [x, y, 1]), dot(v, [x, y, 1])) on the box [x0, y0, x1, y1] (Blender XY). */
export interface Chart { box: [number, number, number, number]; u: [number, number, number]; v: [number, number, number] }

type P = [number, number];
/** Affine map through three (xy -> uv) points, or null for a degenerate triangle. */
export function affineFrom3(p: P[], uv: P[]): { u: [number, number, number]; v: [number, number, number] } | null {
  const [a, b, c] = p, d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(d) < 1e-9) return null;
  const solve = (fa: number, fb: number, fc: number): [number, number, number] => {
    const gx = ((fb - fa) * (c[1] - a[1]) - (fc - fa) * (b[1] - a[1])) / d;
    const gy = ((fc - fa) * (b[0] - a[0]) - (fb - fa) * (c[0] - a[0])) / d;
    return [gx, gy, fa - gx * a[0] - gy * a[1]];
  };
  return { u: solve(uv[0][0], uv[1][0], uv[2][0]), v: solve(uv[0][1], uv[1][1], uv[2][1]) };
}

const same = (a: number[], b: number[]) => a.every((x, k) => Math.abs(x - b[k]) < 1e-6);

/** Triangles (Blender XY + uv1) -> charts; triangles sharing one affine map merge into one box. */
export function chartsFromTriangles(tris: { p: P[]; uv: P[] }[]): Chart[] {
  const out: Chart[] = [];
  for (const t of tris) {
    const f = affineFrom3(t.p, t.uv);
    if (!f) continue;
    const xs = t.p.map((q) => q[0]), ys = t.p.map((q) => q[1]);
    const box: Chart["box"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const c = out.find((c) => same(c.u, f.u) && same(c.v, f.v));
    if (c) c.box = [Math.min(c.box[0], box[0]), Math.min(c.box[1], box[1]), Math.max(c.box[2], box[2]), Math.max(c.box[3], box[3])];
    else out.push({ box, u: f.u, v: f.v });
  }
  return out;
}

/** CPU twin of the shader lookup (tests): the first chart whose box contains (x, y), else null. */
export function chartUv(charts: Chart[], x: number, y: number): P | null {
  for (const c of charts) {
    const [x0, y0, x1, y1] = c.box;
    if (x >= x0 - 1e-4 && x <= x1 + 1e-4 && y >= y0 - 1e-4 && y <= y1 + 1e-4)
      return [c.u[0] * x + c.u[1] * y + c.u[2], c.v[0] * x + c.v[1] * y + c.v[2]];
  }
  return null;
}

/** Charts of a planar mesh's uv1 (LightmapUV), in Blender XY (three x, -z). */
export function chartsOfMesh(mesh: THREE.Mesh): Chart[] {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry, P = g.attributes.position, U = g.attributes.uv1, v = new THREE.Vector3();
  if (!U) return [];
  const n = g.index ? g.index.count : P.count, at = (k: number) => (g.index ? g.index.getX(k) : k);
  const tris: { p: P[]; uv: P[] }[] = [];
  for (let k = 0; k + 2 < n; k += 3) {
    const ids = [at(k), at(k + 1), at(k + 2)];
    tris.push({
      p: ids.map((i) => { v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld); return [v.x, -v.z] as P; }),
      uv: ids.map((i) => [U.getX(i), U.getY(i)] as P),
    });
  }
  return chartsFromTriangles(tris);
}

/** GLSL: lightmap UV for a line or goal-post fragment; falls back to the mesh's own UV off the charts. */
export function pitchLinesGlsl(n: number) {
  return /* glsl */ `
uniform vec4 uChartBox[${n}]; uniform vec3 uChartU[${n}]; uniform vec3 uChartV[${n}];
vec2 pitchLmUv( vec3 pB, vec2 own ) {
  for ( int i = 0; i < ${n}; i ++ ) {
    vec4 b = uChartBox[ i ];
    if ( all( greaterThanEqual( pB.xy, b.xy - 1e-4 ) ) && all( lessThanEqual( pB.xy, b.zw + 1e-4 ) ) )
      return vec2( dot( vec3( pB.xy, 1.0 ), uChartU[ i ] ), dot( vec3( pB.xy, 1.0 ), uChartV[ i ] ) );
  }
  return own;
}
`;
}

export function chartUniforms(charts: Chart[]) {
  return {
    uChartBox: { value: charts.map((c) => new THREE.Vector4(...c.box)) },
    uChartU: { value: charts.map((c) => new THREE.Vector3(...c.u)) },
    uChartV: { value: charts.map((c) => new THREE.Vector3(...c.v)) },
  };
}
