import * as THREE from "three";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, fetchManifest, makeLoaders, runJobs, type Assets } from "./loader";
import { Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress, renderPanel } from "./ui";
import { toBlender } from "./coords";
import { parseSeats, indexSections } from "./seatsData";
import { mockAvailability } from "./availability";
import { SeatField, visibleSections, SEAT_LOD_DIST } from "./seats";
import { SectionPatches } from "./sectionPatches";
import { CameraRig } from "./camera";
import { cameraPose, sectionFraming, type Pose } from "./flyto";
import { onClick } from "./picking";
import { reduce, initialState, type Action } from "./state";
import type { State } from "./loader";

const params = new URLSearchParams(location.search);

async function boot() {
  const missing = missingCapabilities(probe());
  if (missing.length) return showFatal(`Missing: ${missing.join(", ")}.`);
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
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
  hideOverlay();
  start(renderer, assets);
}

function start(renderer: THREE.WebGLRenderer, a: Assets) {
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const table = parseSeats(a.seatsBin), idx = indexSections(table);
  const avail = mockAvailability(table, idx);
  const seats = new SeatField(table, idx, a.sections.sections, avail);
  const patches = new SectionPatches(table, idx, avail);
  scene.add(seats.mesh, patches.mesh);
  const rig = new CameraRig(renderer.domElement);
  const overview = cameraPose(a.cameras["CAM_Aerial_SW"]);
  const camParam = params.get("cam");
  rig.jump(camParam && a.cameras[camParam] ? cameraPose(a.cameras[camParam]) : overview);
  const camera = rig.camera;
  // fallback lighting until lightmaps exist (Review Focus 4); lighting.ts replaces this in Task 9
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
  sun.position.set(-300, 250, 200);
  scene.add(sun);
  const perf = new Perf(params.has("stats"));
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${innerWidth}x${innerHeight}`).split("x").map(Number);
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  };
  addEventListener("resize", resize);
  resize();
  renderer.info.autoReset = false;
  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info, flyTo: (p: Pose) => rig.flyTo(p) });

  let app = initialState;
  let lightingChanged: ((l: State) => void) | undefined;   // set in Task 9
  const secById = new Map(a.sections.sections.map((s) => [Number(s.id), s]));
  const ray = new THREE.Raycaster();
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "section" && app.view.kind === "section") rig.flyTo(sectionFraming(secById.get(app.view.section)!));
    if (act.type === "back") rig.flyTo(overview);
    if (act.type === "lighting") lightingChanged?.(app.lighting);
    draw();
  };
  const draw = () => {
    const v = app.view, sec = v.kind === "section" ? secById.get(v.section) : undefined;
    let available = 0, total = 0;
    if (v.kind === "section") {
      const { start, end } = idx.get(v.section)!;
      total = end - start;
      for (let i = start; i < end; i++) available += avail[i] === 0 ? 1 : 0;
    }
    renderPanel(app, { sectionLabel: sec?.id, tier: sec?.tier, available, total }, {
      lighting: (l) => dispatch({ type: "lighting", lighting: l }),
      back: () => dispatch({ type: "back" }),
    });
  };
  onClick(renderer.domElement, (ndc) => {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObject(patches.mesh, false)[0];
    dispatch(hit ? { type: "section", section: patches.sectionOfFace(hit.faceIndex!) } : { type: "none" });
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));
  draw();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    rig.update(clock.getDelta());
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST, app.view.kind === "section" ? app.view.section : -1);
    seats.setVisibleSections(vis);
    patches.setHidden(vis);
    renderer.render(scene, camera);
    perf.end();
  });
}

boot();
