import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { V3 } from "./coords";

export type State = "day" | "golden" | "night";
export const STATES: State[] = ["day", "golden", "night"];

export interface Manifest {
  version: number;
  rgbmRange: number;
  stadium: string;
  trees: null | { glb: string; impostors: Record<string, { atlas: string; frames: number; size: number; centerZ: number }> };
  seats: string;
  sections: string;
  cameras: string;
  states: Record<State, { night: number; exposure: number; env: string | null; lightmaps: Record<string, string> }>;
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
  lightmaps: Record<State, Record<string, THREE.Texture>>;
  env: Record<State, THREE.DataTexture | null>;
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

const BASE = "assets/";
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

export function assetJobs(m: Manifest, L: ReturnType<typeof makeLoaders>): Job<unknown>[] {
  const jobs: Job<unknown>[] = [
    { file: m.stadium, run: (p) => L.gltf.loadAsync(BASE + m.stadium, pct(p)) },
    { file: m.seats, run: (p) => { L.file.setResponseType("arraybuffer"); return L.file.loadAsync(BASE + m.seats, pct(p)); } },
    { file: m.sections, run: async () => (await fetch(BASE + m.sections)).json() },
    { file: m.cameras, run: async () => (await fetch(BASE + m.cameras)).json() },
  ];
  if (m.trees) jobs.push({ file: m.trees.glb, optional: true, run: (p) => L.gltf.loadAsync(BASE + m.trees!.glb, pct(p)) });
  for (const s of STATES) {
    const st = m.states[s];
    for (const [, f] of Object.entries(st.lightmaps)) jobs.push({ file: f, run: () => L.ktx2.loadAsync(BASE + f) });
    if (st.env) jobs.push({ file: st.env, run: () => L.hdr.loadAsync(BASE + st.env!) });
  }
  return jobs;
}

export function collect(m: Manifest, out: Map<string, unknown>): Assets {
  const lightmaps = {} as Assets["lightmaps"];
  const env = {} as Assets["env"];
  for (const s of STATES) {
    lightmaps[s] = {};
    for (const [g, f] of Object.entries(m.states[s].lightmaps)) {
      const t = out.get(f) as THREE.Texture;
      t.colorSpace = THREE.NoColorSpace;
      t.channel = 1;                                    // TEXCOORD_1 = LightmapUV
      lightmaps[s][g] = t;
    }
    env[s] = m.states[s].env ? (out.get(m.states[s].env!) as THREE.DataTexture) : null;
    if (env[s]) env[s]!.mapping = THREE.EquirectangularReflectionMapping;
  }
  return {
    manifest: m,
    stadium: out.get(m.stadium) as GLTF,
    trees: m.trees ? ((out.get(m.trees.glb) as GLTF) ?? null) : null,
    seatsBin: out.get(m.seats) as ArrayBuffer,
    sections: out.get(m.sections) as SectionsDoc,
    cameras: out.get(m.cameras) as Record<string, CameraDef>,
    lightmaps, env,
  };
}
