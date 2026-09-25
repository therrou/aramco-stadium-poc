import * as THREE from "three";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, fetchManifest, makeLoaders, runJobs, type Assets } from "./loader";
import { Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress } from "./ui";
import { toBlender, type V3 } from "./coords";
import { imageStats, type Box } from "./frameStats";
import { parseSeats, indexSections, SeatDirectory, parseSeatParam, formatSeat, type SeatRef } from "./seatsData";
import type { Tier } from "./tiers";
import { SeatField, SeatHighlight, nearSections, visibleSections, NEAR_SEAT_CAP, SEAT_LOD_DIST, SEAT_NEAR_M } from "./seats";
import { SectionPatches } from "./sectionPatches";
import { CameraRig, ZOOM_S, pivotOf } from "./camera";
import { cameraPose, seatViewPose, SEAT_EXP, type Pose } from "./flyto";
import { nearestSeatToRay } from "./seatPick";
import { DepthProbe, acceptPatchHit, onClick } from "./picking";
import { reduce, initialState, parseLighting, type Action, type AppState } from "./state";
import { STATES, type State } from "./loader";
import { GROUND_RE, setupStadiumMaterials, specOccK, type SharedUniforms } from "./stadium";
import { Lighting, makeComposer } from "./lighting";
import { SunShadow } from "./sunShadow";
import { missingLightmaps } from "./lightingState";
import { setupTrees } from "./trees";
import { heroesIn } from "./heroViews";
import { renderHeader } from "./ui/header";
import { Sidebar } from "./ui/sidebar";
import { Controls } from "./ui/controls";
import { Tooltip } from "./ui/tooltip";

const params = new URLSearchParams(location.search);
/** Hover picking interval (ms): ~20 Hz, each pick may draw one depth-probe pixel. */
const HOVER_MS = 50;
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
  if (params.get("chrome") === "0") document.body.classList.add("bare");
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const table = parseSeats(a.seatsBin), idx = indexSections(table), dir = new SeatDirectory(table, idx);
  const stage = document.getElementById("stage")!;
  const rig = new CameraRig(renderer.domElement);
  const overview = pivotOf(cameraPose(a.cameras["CAM_Aerial_SW"]));   // v3: orbit around the stadium, same view
  // final review 2: exposure follows each flight; back at the overview it is CAM_Aerial_SW's, not ?cam's
  const overviewExp = a.cameras["CAM_Aerial_SW"].exposure ?? -0.4;
  const camParam = params.get("cam");
  const camDef = camParam ? a.cameras[camParam] : undefined;
  rig.jump(camDef ? pivotOf(cameraPose(camDef)) : overview, camDef?.exposure ?? overviewExp);
  const camera = rig.camera;
  const shared: SharedUniforms = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: a.manifest.rgbmRange }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  // one "lightmaps present" flag for materials and Lighting: every state needs every group, else no lightmaps at all
  const glbGroups = new Set<string>();
  a.stadium.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && typeof o.userData.lightmap === "string") glbGroups.add(o.userData.lightmap); });
  const missing = missingLightmaps(a.lightmaps, glbGroups);
  const useLightmaps = missing.length === 0;
  if (!useLightmaps && STATES.some((s) => Object.keys(a.lightmaps[s]).length > 0))
    console.warn(`Lighting: incomplete lightmap bake, using fallback lights. Missing: ${missing.join(", ")}`);
  const groups = setupStadiumMaterials(a.stadium.scene, shared, useLightmaps, renderer.capabilities.reversedDepthBuffer, renderer.capabilities.getMaxAnisotropy());
  const emissive = new Set<THREE.MeshStandardMaterial>();   // Set: the optimized glb shares materials between meshes
  a.stadium.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (m?.userData && (m.userData.emDay > 0 || m.userData.emNight > 0)) emissive.add(m);
  });
  const startState = parseLighting(params.get("state"));
  const lighting = new Lighting(renderer, scene, a, groups, [...emissive], startState, shared, useLightmaps);
  // S1 (v3): live sun shadows sharpen the baked sun (lightmapped materials) and shade the seats and trees
  shared.uSun = lighting.outdoor.uSun;
  shared.uSunDirView = lighting.outdoor.uSunDirView;
  shared.uAmbient = lighting.outdoor.uAmbient;
  const sun = useLightmaps ? new SunShadow(renderer, scene) : null;
  a.stadium.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    m.receiveShadow = true;
    // The sails cast: they block the direct beam (their diffuse translucency is in the bake, which the
    // sharpening leaves alone), so direct sun reaches the bowl only through the oculus, as in Cycles.
    // Ground planes only receive: the site's plaza/lawn plane runs under the bowl just above the pitch and
    // hid it from the sun in the shadow map.
    m.castShadow = !mat.transparent && !/Glass|Net/.test(mat.name) && !GROUND_RE.test(mat.name)
      && !/^M_(RoadLine|StreetGlow|DeckUnder|PodiumStrip|PitchSurround|Grass|LineWhite)\b/.test(mat.name);
  });
  const seats = new SeatField(table, idx, a.sections.sections, lighting.outdoor);
  const tierOf = new Map(a.sections.sections.map((s) => [Number(s.id), s.tier as Tier]));
  const patches = new SectionPatches(table, idx, lighting.outdoor, (id) => tierOf.get(id));
  const highlight = new SeatHighlight();
  scene.add(seats.mesh, seats.near, patches.mesh, highlight.mesh);
  for (const m of [seats.mesh, seats.near]) { m.castShadow = true; m.receiveShadow = true; }
  patches.mesh.receiveShadow = true;
  if (a.trees) {
    setupTrees(a.trees, a.impostors, lighting.outdoor);
    a.trees.scene.traverse((o) => {          // S1: tree meshes cast; impostor billboards (shader material) do not
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = !(m.material as THREE.ShaderMaterial).isShaderMaterial; m.receiveShadow = true; }
    });
    scene.add(a.trees.scene);
  }
  const composer = makeComposer(renderer, scene, camera);
  const perf = new Perf(params.has("stats"));
  // Review Focus 5: size to the stage (the sidebar or bottom sheet takes the rest), not to the window
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${stage.clientWidth}x${stage.clientHeight}`).split("x").map(Number);
    if (!(w > 0 && h > 0)) return;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
    composer.setSize(w, h);
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  renderer.info.autoReset = false;

  let app: AppState = { ...initialState, lighting: startState };
  const seatPose = (r: SeatRef) => seatViewPose(dir.position(dir.find(r)));
  const syncUrl = () => {
    const u = new URL(location.href);
    if (app.view.kind === "seat") u.searchParams.set("seat", formatSeat(app.view.seat)); else u.searchParams.delete("seat");
    history.replaceState(null, "", u);
  };
  const enterSeat = (r: SeatRef, fly: boolean) => {
    rig.setMode("look");
    if (fly) rig.flyTo(seatPose(r), SEAT_EXP); else rig.jump(seatPose(r), SEAT_EXP);
    highlight.set(seats.matrixOf(dir.find(r)));
  };
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "seat" && app.view.kind === "seat") { controls.clearCamera(); enterSeat(app.view.seat, true); }
    if (act.type === "back" || act.type === "camera") {
      rig.setMode("orbit");
      highlight.set(null);
      const c = act.type === "camera" ? a.cameras[act.camera] : undefined;
      if (act.type === "back") controls.clearCamera();
      rig.flyTo(c ? pivotOf(cameraPose(c)) : overview, c?.exposure ?? overviewExp);
    }
    if (act.type === "lighting") lighting.request(app.lighting);
    rig.setAutoOrbit(app.autoOrbit);
    syncUrl();
    draw();
  };

  renderHeader(document.getElementById("header")!, a.sections.seats_total);
  const sidebar = new Sidebar(document.getElementById("sidebar")!, dir, a.sections.sections, {
    seeView: (r) => dispatch({ type: "seat", seat: r }),
    hero: (cam) => dispatch({ type: "camera", camera: cam }),
    back: () => dispatch({ type: "back" }),
    copyLink: () => { navigator.clipboard?.writeText(location.href).then(() => sidebar.linkCopied(), () => {}); },
  }, heroesIn(a.cameras));
  const controls = new Controls(document.getElementById("controls")!, {
    lighting: (l) => dispatch({ type: "lighting", lighting: l }),
    zoom: (f) => { if (app.autoOrbit) dispatch({ type: "autoOrbit", on: false }); rig.zoom(f); },
    reset: () => (app.view.kind === "seat" ? rig.flyTo(seatPose(app.view.seat), SEAT_EXP, { direct: true, seconds: ZOOM_S * 2 }) : rig.flyTo(overview, overviewExp)),
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    camera: (cam) => dispatch({ type: "camera", camera: cam }),
    autoOrbit: (on) => dispatch({ type: "autoOrbit", on }),
  });
  const draw = () => { sidebar.render(app); controls.render(app); };
  rig.onUserInput(() => { if (app.autoOrbit) dispatch({ type: "autoOrbit", on: false }); });

  // picking: section strips (always raycastable, even where seats are drawn), wall check, nearest seat to the ray
  const ray = new THREE.Raycaster(), probe = new DepthProbe(renderer);
  const pickSeat = (ndc: THREE.Vector2): number => {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObject(patches.mesh, false)[0];
    if (!hit) return -1;
    if (!acceptPatchHit(hit.distance, probe.distance(a.stadium.scene, rig.camera, ndc))) return -1;   // final review 6
    const r = idx.get(patches.sectionOfFace(hit.faceIndex!));
    return r ? nearestSeatToRay(table, r, toBlender(ray.ray.origin), toBlender(ray.ray.direction), toBlender(hit.point)) : -1;
  };
  const tooltip = new Tooltip(document.getElementById("tooltip")!);
  const dom = renderer.domElement;
  const toNdc = (e: PointerEvent) => {
    const r = dom.getBoundingClientRect();
    return { ndc: new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let hover: ReturnType<typeof toNdc> | null = null, lastHover = 0, dragging = false;
  dom.addEventListener("pointermove", (e) => { hover = e.pointerType === "mouse" ? toNdc(e) : null; });
  dom.addEventListener("pointerdown", () => { dragging = true; hover = null; tooltip.hide(); });
  addEventListener("pointerup", () => (dragging = false));
  dom.addEventListener("pointerleave", () => { hover = null; tooltip.hide(); });
  onClick(dom, (ndc) => {
    const i = pickSeat(ndc);
    if (i >= 0) { tooltip.hide(); dispatch({ type: "seat", seat: dir.ref(i) }); }
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));

  // deep link (Review Focus 1): only a real seat opens seat view; anything else is the overview
  const linked = parseSeatParam(params.get("seat"));
  if (linked && dir.find(linked) >= 0) { app = reduce(app, { type: "seat", seat: linked }); enterSeat(linked, false); }
  else if (params.has("seat")) syncUrl();
  draw();

  const frame = (dt: number) => {
    rig.update(dt);
    const now = performance.now();
    if (rig.flying) tooltip.hide();
    else if (hover && !dragging && now - lastHover >= HOVER_MS) {
      lastHover = now;
      const h = hover, i = pickSeat(h.ndc);
      if (i >= 0) tooltip.show(h.x, h.y, dir.ref(i), tierOf.get(table.section[i]) ?? "Lower"); else tooltip.hide();
      hover = null;                                                          // re-pick only after the pointer moves again
    }
    const focus = app.view.kind === "seat" ? app.view.seat.section : -1;
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST, focus);
    if (seats.setVisibleSections(vis, nearSections(toBlender(camera.position), a.sections.sections, SEAT_NEAR_M, NEAR_SEAT_CAP)) && sun)
      renderer.shadowMap.needsUpdate = true;             // the drawn seats changed: their shadows too
    patches.setHidden(vis);
    highlight.update(now / 1000);
    lighting.update(dt, rig.exposure, camera);
    sun?.update(lighting.t.night);
    composer.render(dt);
  };

  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info, scene, flyTo: (p: Pose) => rig.flyTo(p),
    setState: (s: State) => dispatch({ type: "lighting", lighting: s }),
    get night() { return lighting.t.night; }, tick: (dt = 1 / 60) => frame(dt),
    renderer, composer, camera, rig, lighting, stadium: a.stadium.scene, assets: a,
    get app() { return app; }, dispatch, pickSeat, pivot: pivotOf,
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

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    frame(clock.getDelta());
    perf.end();
  });
}

boot();
