import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, fetchManifest, makeLoaders, runJobs, type Assets } from "./loader";
import { Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress } from "./ui";
import { toThree } from "./coords";

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
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 8000);
  const cam = a.cameras["CAM_Aerial_SW"];
  camera.position.copy(toThree(cam.eye));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(toThree(cam.target));
  controls.enableDamping = true;
  // fallback lighting until lightmaps exist (Review Focus 4); lighting.ts replaces this in Task 9
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
  sun.position.set(-300, 250, 200);
  scene.add(sun);
  const perf = new Perf(params.has("stats"));
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${innerWidth}x${innerHeight}`).split("x").map(Number);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);
  resize();
  renderer.info.autoReset = false;
  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info });
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    controls.update();
    renderer.render(scene, camera);
    perf.end();
  });
}

boot();
