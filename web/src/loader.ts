import * as THREE from "three";
import { assetUrl } from "./assetBase";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { V3 } from "./coords";

/** Day was dropped (2026-09-28, unused on the frontend): old manifests may still list it, and it is ignored. */
export type State = "golden" | "night";
export const STATES: State[] = ["golden", "night"];

export interface Manifest {
  version: number;
  rgbmRange: number;
  /** v4: lightmaps are gamma RGB decoded as pow(rgb, lmGamma) * rgbmRange; absent = RGBM. */
  lmGamma?: number;
  stadium: string;
  trees: null | { glb: string; impostors: Record<string, { atlas: string; frames: number; size: number; centerZ: number }> };
  seats: string;
  sections: string;
  cameras: string;
  states: Partial<Record<State, { night: number; exposure: number; env: string | null; lightmaps: Record<string, string> }>>;
}
export interface CameraDef { eye: V3; target: V3; hfov: number; exposure: number }
export interface SectionView { eye: V3; target: V3; fov: number; seat: string }
export interface Section { id: string; tier: "Lower" | "Club" | "Upper"; level: number; rows: number; seats: number; centroid: V3; angle_deg: number; view: SectionView }
export interface SectionsDoc { seats_total: number; sections: Section[] }
export interface Assets {
  manifest: Manifest;
  stadium: GLTF;
  trees: GLTF | null;
  seatsBin: ArrayBuffer;
  sections: SectionsDoc;
  cameras: Record<string, CameraDef>;
  /** Only the states loaded so far: the start state up front, the other one later (loadState). */
  lightmaps: Partial<Record<State, Record<string, THREE.Texture>>>;
  env: Partial<Record<State, THREE.DataTexture | null>>;
  /** Far-tree impostor atlases by species; a species whose atlas failed to load is absent. */
  impostors: Record<string, { atlas: THREE.Texture; frames: number; size: number; centerZ: number }>;
}

export class AssetError extends Error {
  constructor(public file: string, cause: unknown) {
    super(`Could not load ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface Job<T> { file: string; optional?: boolean; run: (p: (f: number) => void) => Promise<T> }

/** Runs jobs in parallel. `done` carries finished results across retries. */
export async function runJobs<T>(jobs: Job<T>[], onProgress: (f: number) => void, done = new Map<string, T | null>()) {
  const frac = new Map<string, number>(jobs.map((j) => [j.file, done.has(j.file) ? 1 : 0]));
  let last = 0;
  const report = () => {
    const f = [...frac.values()].reduce((a, b) => a + b, 0) / Math.max(jobs.length, 1);
    last = Math.max(last, f);
    onProgress(last);
  };
  let firstError: AssetError | null = null;
  await Promise.all(jobs.filter((j) => !done.has(j.file)).map(async (j) => {
    try {
      done.set(j.file, await j.run((f) => { frac.set(j.file, f); report(); }));
    } catch (e) {
      if (j.optional) done.set(j.file, null);
      else firstError ??= new AssetError(j.file, e);
    }
    frac.set(j.file, 1);
    report();
  }));
  if (firstError) throw firstError;
  return done as Map<string, T | null>;
}

const BASE = assetUrl("assets/");
const pct = (p: (f: number) => void) => (e: ProgressEvent) => e.total && p(e.loaded / e.total);

export function makeLoaders(renderer: THREE.WebGLRenderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath("basis/").detectSupport(renderer);
  const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return { ktx2, gltf, hdr: new HDRLoader(), file: new THREE.FileLoader() };
}

export async function fetchManifest(): Promise<Manifest> {
  const r = await fetch(BASE + "manifest.json");
  if (!r.ok) throw new AssetError("manifest.json", new Error(`HTTP ${r.status}`));
  return r.json();
}

/** Final review 8: a 404 page must not reach JSON.parse; the error names the file. */
export async function fetchJson(url: string, file: string, f: typeof fetch = fetch) {
  const r = await f(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}`);
  return r.json();
}

/**
 * First-frame jobs: the stadium, seats and the start state's lighting (main adds treeJobs). The other
 * lighting state (stateJobs) loads only when the user picks it, which keeps ~6 MB off the page.
 */
export function assetJobs(m: Manifest, L: ReturnType<typeof makeLoaders>, states: State[] = STATES): Job<unknown>[] {
  const jobs: Job<unknown>[] = [
    { file: m.stadium, run: (p) => L.gltf.loadAsync(BASE + m.stadium, pct(p)) },
    { file: m.seats, run: (p) => { L.file.setResponseType("arraybuffer"); return L.file.loadAsync(BASE + m.seats, pct(p)); } },
    { file: m.sections, run: () => fetchJson(BASE + m.sections, m.sections) },
    { file: m.cameras, run: () => fetchJson(BASE + m.cameras, m.cameras) },
  ];
  for (const s of states) jobs.push(...stateJobs(m, L, s));
  return jobs;
}

export function stateJobs(m: Manifest, L: ReturnType<typeof makeLoaders>, s: State): Job<unknown>[] {
  const st = m.states[s];
  if (!st) return [];
  const jobs: Job<unknown>[] = Object.values(st.lightmaps).map((f) => ({ file: f, run: () => L.ktx2.loadAsync(BASE + f) }));
  if (st.env) jobs.push({ file: st.env, run: () => L.hdr.loadAsync(BASE + st.env!) });
  return jobs;
}

/** Trees and their impostor atlases: all optional, a failure just leaves the site without trees. */
export function treeJobs(m: Manifest, L: ReturnType<typeof makeLoaders>): Job<unknown>[] {
  if (!m.trees) return [];
  return [
    { file: m.trees.glb, optional: true, run: (p) => L.gltf.loadAsync(BASE + m.trees!.glb, pct(p)) },
    ...Object.values(m.trees.impostors).map((im) => ({ file: im.atlas, optional: true, run: () => L.ktx2.loadAsync(BASE + im.atlas) })),
  ];
}

/** One lighting state's lightmaps and env from finished jobs. */
export function collectState(m: Manifest, s: State, out: Map<string, unknown>) {
  const lightmaps: Record<string, THREE.Texture> = {};
  const st = m.states[s];
  for (const [g, f] of Object.entries(st?.lightmaps ?? {})) {
    const t = out.get(f) as THREE.Texture;
    t.colorSpace = THREE.NoColorSpace;
    t.channel = 1;                                    // TEXCOORD_1 = LightmapUV
    // A7 (v2): the KTX2 lightmaps carry mips (optimize_web.sh); without them distant charts shimmered
    t.minFilter = (t.mipmaps?.length ?? 0) > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.generateMipmaps = false;
    lightmaps[g] = t;
  }
  const env = st?.env ? (out.get(st.env) as THREE.DataTexture) : null;
  if (env) env.mapping = THREE.EquirectangularReflectionMapping;
  return { lightmaps, env };
}

export function collectTrees(m: Manifest, out: Map<string, unknown>) {
  const impostors: Assets["impostors"] = {};
  if (m.trees) for (const [sp, im] of Object.entries(m.trees.impostors)) {
    const t = out.get(im.atlas) as THREE.Texture | null | undefined;
    if (t) { t.colorSpace = THREE.SRGBColorSpace; impostors[sp] = { ...im, atlas: t }; }
  }
  return { trees: m.trees ? ((out.get(m.trees.glb) as GLTF) ?? null) : null, impostors };
}

/** First-frame assets; trees and the states not in `states` are filled in later. */
export function collect(m: Manifest, out: Map<string, unknown>, states: State[] = STATES): Assets {
  const lightmaps: Assets["lightmaps"] = {}, env: Assets["env"] = {};
  for (const s of states) ({ lightmaps: lightmaps[s], env: env[s] } = collectState(m, s, out));
  return {
    manifest: m,
    stadium: out.get(m.stadium) as GLTF,
    trees: null,
    seatsBin: out.get(m.seats) as ArrayBuffer,
    sections: out.get(m.sections) as SectionsDoc,
    cameras: out.get(m.cameras) as Record<string, CameraDef>,
    lightmaps, env, impostors: {},
  };
}
