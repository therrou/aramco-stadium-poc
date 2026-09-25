import * as THREE from "three";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, fetchManifest, makeLoaders, runJobs, type Assets } from "./loader";
import { Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress, renderPanel } from "./ui";
import { toBlender, type V3 } from "./coords";
import { imageStats, type Box } from "./frameStats";
import { parseSeats, indexSections } from "./seatsData";
import type { Tier } from "./tiers";
import { SeatField, visibleSections, SEAT_LOD_DIST } from "./seats";
import { SectionPatches } from "./sectionPatches";
import { CameraRig } from "./camera";
import { cameraPose, sectionFraming, type Pose } from "./flyto";
import { DepthProbe, acceptPatchHit, onClick } from "./picking";
import { reduce, initialState, parseLighting, type Action } from "./state";
import { STATES, type State } from "./loader";
import { setupStadiumMaterials, specOccK, type SharedUniforms } from "./stadium";
import { Lighting, makeComposer } from "./lighting";
import { missingLightmaps } from "./lightingState";
import { setupTrees } from "./trees";

const params = new URLSearchParams(location.search);
/** Camera exposure (stops) in the section view: the CAM_Seat_* cameras' value. */
const SECTION_EXP = 0.1;

async function boot() {
  const missing = missingCapabilities(probe());
  if (missing.length) return showFatal(`Missing: ${missing.join(", ")}.`);
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try {                                               // final review 7: never leave a blank page
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance",
      reversedDepthBuffer: !params.has("noreverse") });   // Task 13b (A); ignored without EXT_clip_control
  } catch (e) {
    return showFatal(`Could not start WebGL: ${(e as Error).message}`);
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const L = makeLoaders(renderer);
  const done = new Map<string, unknown>();
  const attempt = async (): Promise<Assets> => {
    try {
      const m = await fetchManifest();
      showProgress(0);
      return collect(m, await runJobs(assetJobs(m, L), showProgress, done));
    } catch (e) {
      const file = e instanceof AssetError ? e.file : "assets";
      return new Promise((res) => showError(file, String((e as Error).message), () => res(attempt())));
    }
  };
  const assets = await attempt();
  try {
    start(renderer, assets);
    hideOverlay();
  } catch (e) {
    console.error(e);
    renderer.setAnimationLoop(null);
    showFatal(`The viewer failed to start: ${(e as Error).message}`);
  }
}

function start(renderer: THREE.WebGLRenderer, a: Assets) {
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const table = parseSeats(a.seatsBin), idx = indexSections(table);
  const rig = new CameraRig(renderer.domElement);
  const overview = cameraPose(a.cameras["CAM_Aerial_SW"]);
  // final review 2: exposure follows each flight; back at the overview it is CAM_Aerial_SW's, not ?cam's
  const overviewExp = a.cameras["CAM_Aerial_SW"].exposure ?? -0.4;
  const camParam = params.get("cam");
  const camDef = camParam ? a.cameras[camParam] : undefined;
  rig.jump(camDef ? cameraPose(camDef) : overview, camDef?.exposure ?? overviewExp);
  const camera = rig.camera;
  const shared: SharedUniforms = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: a.manifest.rgbmRange }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  // one "lightmaps present" flag for materials and Lighting: every state needs every group, else no lightmaps at all
  const glbGroups = new Set<string>();
  a.stadium.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && typeof o.userData.lightmap === "string") glbGroups.add(o.userData.lightmap); });
  const missing = missingLightmaps(a.lightmaps, glbGroups);
  const useLightmaps = missing.length === 0;
  if (!useLightmaps && STATES.some((s) => Object.keys(a.lightmaps[s]).length > 0))
    console.warn(`Lighting: incomplete lightmap bake, using fallback lights. Missing: ${missing.join(", ")}`);
  const groups = setupStadiumMaterials(a.stadium.scene, shared, useLightmaps, renderer.capabilities.reversedDepthBuffer);
  const emissive = new Set<THREE.MeshStandardMaterial>();   // Set: the optimized glb shares materials between meshes
  a.stadium.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (m?.userData && (m.userData.emDay > 0 || m.userData.emNight > 0)) emissive.add(m);
  });
  const startState = parseLighting(params.get("state"));
  const lighting = new Lighting(renderer, scene, a, groups, [...emissive], startState, shared, useLightmaps);
  const seats = new SeatField(table, idx, a.sections.sections, lighting.outdoor);
  const tierOf = new Map(a.sections.sections.map((s) => [Number(s.id), s.tier as Tier]));
  const patches = new SectionPatches(table, idx, lighting.outdoor, (id) => tierOf.get(id));
  scene.add(seats.mesh, patches.mesh);
  if (a.trees) { setupTrees(a.trees, a.impostors, lighting.outdoor); scene.add(a.trees.scene); }
  const composer = makeComposer(renderer, scene, camera);
  const perf = new Perf(params.has("stats"));
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${innerWidth}x${innerHeight}`).split("x").map(Number);
    renderer.setSize(w, h, false);
    rig.resize(w, h);
    composer.setSize(w, h);
  };
  addEventListener("resize", resize);
  resize();
  renderer.info.autoReset = false;
  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info, scene, flyTo: (p: Pose) => rig.flyTo(p),
    setState: (s: State) => dispatch({ type: "lighting", lighting: s }),
    get night() { return lighting.t.night; }, tick: (dt = 1 / 60) => frame(dt),
    renderer, composer, camera, rig, lighting, stadium: a.stadium.scene, assets: a,
    /** v2 Task 1: metrics of the next rendered frame (drawing buffer is read in the same task as the render). */
    stats: (box?: Box) => {
      frame(0);
      renderer.setRenderTarget(null);
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return imageStats(px, w, h, box, true);
    },
    /** Dev server only: saves the next frame to renders/web_v2/<name>.png (toBlob snapshots the bitmap at call time). */
    save: (name: string) => new Promise<string>((done) => {
      frame(0);
      renderer.domElement.toBlob((b) => fetch(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body: b }).then((r) => done(r.statusText || String(r.status))));
    }),
    /** Camera-nudge test: moves eye and target sideways (camera right) by `m` metres. */
    nudge: (m: number) => {
      const p = rig.pose(), off = toBlender(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(m));
      rig.jump({ eye: p.eye.map((v, k) => v + off[k]) as V3, target: p.target.map((v, k) => v + off[k]) as V3, hfov: p.hfov });
    } });

  let app = { ...initialState, lighting: startState };
  const lightingChanged = (l: State) => lighting.request(l);
  const secById = new Map(a.sections.sections.map((s) => [Number(s.id), s]));
  const ray = new THREE.Raycaster(), probe = new DepthProbe(renderer);
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "section" && app.view.kind === "section") rig.flyTo(sectionFraming(secById.get(app.view.section)!), SECTION_EXP);
    if (act.type === "back") rig.flyTo(overview, overviewExp);
    if (act.type === "lighting") lightingChanged(app.lighting);
    draw();
  };
  const draw = () => {
    const v = app.view, sec = v.kind === "section" ? secById.get(v.section) : undefined;
    let available = 0, total = 0;
    if (v.kind === "section") {
      const { start, end } = idx.get(v.section)!;
      total = end - start;
      available = total;   // v2: no mock availability (panel replaced in Task 14)
    }
    renderPanel(app, { sectionLabel: sec?.id, tier: sec?.tier, available, total }, {
      lighting: (l) => dispatch({ type: "lighting", lighting: l }),
      back: () => dispatch({ type: "back" }),
    });
  };
  onClick(renderer.domElement, (ndc) => {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObject(patches.mesh, false)[0];
    const wall = hit ? probe.distance(a.stadium.scene, rig.camera, ndc) : undefined;   // final review 6
    dispatch(hit && acceptPatchHit(hit.distance, wall) ? { type: "section", section: patches.sectionOfFace(hit.faceIndex!) } : { type: "none" });
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));
  draw();

  const clock = new THREE.Clock();
  const frame = (dt: number) => {
    rig.update(dt);
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST, app.view.kind === "section" ? app.view.section : -1);
    seats.setVisibleSections(vis);
    patches.setHidden(vis);
    lighting.update(dt, rig.exposure, camera);
    composer.render(dt);
  };
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    frame(clock.getDelta());
    perf.end();
  });
}

boot();
