import * as THREE from "three";
import { loadDisplayFont } from "./assetBase";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, collectState, collectTrees, fetchManifest, makeLoaders, runJobs, stateJobs, treeJobs, type Assets } from "./loader";
import { DprGovernor, Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress } from "./ui";
import { toBlender, type V3 } from "./coords";
import { imageStats, type Box } from "./frameStats";
import { parseSeats, indexSections, SeatDirectory, parseSeatParam, formatSeat, type SeatRef } from "./seatsData";
import type { Tier } from "./tiers";
import { SeatField, SeatHighlight, nearSections, visibleSections, NEAR_SEAT_CAP, SEAT_LOD_DIST, SEAT_NEAR_M } from "./seats";
import { SectionPatches } from "./sectionPatches";
import { CameraRig, ZOOM_S, orbitPoseOf, pivotOf } from "./camera";
import { isInside } from "./route";
import { cameraPose, seatViewPose, SEAT_EXP, type Pose } from "./flyto";
import { nearestSeatToRay } from "./seatPick";
import { DepthProbe, acceptPatchHit, onClick } from "./picking";
import { reduce, initialState, parseLighting, sameSeat, type Action, type AppState } from "./state";
import type { State } from "./loader";
import { GROUND_RE, setupStadiumMaterials, specOccK, type SharedUniforms } from "./stadium";
import { Lighting, makeComposer } from "./lighting";
import { SunShadow } from "./sunShadow";
import { BOWL_LAYER, NO_REFLECT_LAYER, PlazaReflection } from "./planarReflect";
import { ledUniforms, makeAdAtlas } from "./ledBoards";
import { makeScreenFeed, isScreen } from "./screens";
import { missingLightmaps } from "./lightingState";
import { setupTrees } from "./trees";
import { heroesIn } from "./heroViews";
import { renderHeader } from "./ui/header";
import { Sidebar } from "./ui/sidebar";
import { Controls } from "./ui/controls";
import { Tooltip } from "./ui/tooltip";
import { Checkout } from "./ui/checkout";
import { Availability, SeatStatus } from "./ticketing";
import { TicketStore } from "./tickets";

loadDisplayFont();   // licensed display font, from the asset base (theme.css no longer references it)

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
  const startState = parseLighting(params.get("state"));
  const attempt = async (): Promise<Assets> => {
    try {
      const m = await fetchManifest();
      showProgress(0);
      // trees load with the first frame too: streamed in later they popped into a finished view (user 2026-09-28)
      const out = await runJobs([...assetJobs(m, L, [startState]), ...treeJobs(m, L)], showProgress, done);
      return { ...collect(m, out, [startState]), ...collectTrees(m, out) };
    } catch (e) {
      const file = e instanceof AssetError ? e.file : "assets";
      return new Promise((res) => showError(file, String((e as Error).message), () => res(attempt())));
    }
  };
  const assets = await attempt();
  try {
    start(renderer, assets, L, startState);
    hideOverlay();
  } catch (e) {
    console.error(e);
    renderer.setAnimationLoop(null);
    showFatal(`The viewer failed to start: ${(e as Error).message}`);
  }
}

function start(renderer: THREE.WebGLRenderer, a: Assets, L: ReturnType<typeof makeLoaders>, startState: State) {
  if (params.get("chrome") === "0") document.body.classList.add("bare");
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const table = parseSeats(a.seatsBin), idx = indexSections(table), dir = new SeatDirectory(table, idx);
  const stage = document.getElementById("stage")!;
  const rig = new CameraRig(renderer.domElement);
  const overview = orbitPoseOf("CAM_Aerial_SW", cameraPose(a.cameras["CAM_Aerial_SW"]));   // orbit around the stadium axis
  // final review 2: exposure follows each flight; back at the overview it is CAM_Aerial_SW's, not ?cam's
  const overviewExp = a.cameras["CAM_Aerial_SW"].exposure ?? -0.4;
  const camParam = params.get("cam");
  const camDef = camParam ? a.cameras[camParam] : undefined;
  rig.jump(camDef ? orbitPoseOf(camParam!, cameraPose(camDef)) : overview, camDef?.exposure ?? overviewExp);
  const camera = rig.camera;
  const shared: SharedUniforms = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: a.manifest.rgbmRange }, uLmGamma: { value: a.manifest.lmGamma ?? 0 }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  // one "lightmaps present" flag for materials and Lighting: every state needs every group, else no lightmaps at all
  const glbGroups = new Set<string>();
  a.stadium.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && typeof o.userData.lightmap === "string") glbGroups.add(o.userData.lightmap); });
  const missing = missingLightmaps(a.lightmaps, glbGroups);
  const useLightmaps = missing.length === 0;
  if (!useLightmaps && Object.values(a.lightmaps).some((l) => Object.keys(l).length > 0))
    console.warn(`Lighting: incomplete lightmap bake, using fallback lights. Missing: ${missing.join(", ")}`);
  ledUniforms.uAds.value = makeAdAtlas();              // pitch LED ad boards (aramco / AKQA)
  const screenFeed = makeScreenFeed(() => (ledUniforms.uAds.value?.image as CanvasImageSource) ?? null);   // v4: looping screens
  screenFeed.onSwap((t) => a.stadium.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && isScreen(m.name)) { m.emissiveMap = t; m.needsUpdate = true; }
  }));
  const groups = setupStadiumMaterials(a.stadium.scene, shared, useLightmaps, renderer.capabilities.reversedDepthBuffer, renderer.capabilities.getMaxAnisotropy());
  const emissive = new Set<THREE.MeshStandardMaterial>();   // Set: the optimized glb shares materials between meshes
  a.stadium.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (m?.userData && (m.userData.emDay > 0 || m.userData.emNight > 0)) emissive.add(m);
  });
  const lighting = new Lighting(renderer, scene, a, groups, [...emissive], startState, shared, useLightmaps);
  // S1 (v3): live sun shadows sharpen the baked sun (lightmapped materials) and shade the seats and trees
  shared.uSun = lighting.outdoor.uSun;
  shared.uSunDirView = lighting.outdoor.uSunDirView;
  shared.uAmbient = lighting.outdoor.uAmbient;
  const sun = useLightmaps ? new SunShadow(renderer, scene) : null;
  // v3 option 2: the plaza mirrors the scene (the lit facade at night), when seen close from outside
  const mirror = useLightmaps ? new PlazaReflection() : null;
  if (mirror) Object.assign(shared, mirror.uniforms);
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
  // ticketing (user request 2026-09-27): seeded sold seats plus this browser's purchases (localStorage)
  const store = new TicketStore(), av = new Availability(dir, a.sections.sections, store.all());
  scene.add(seats.mesh, seats.near, patches.mesh, highlight.mesh);
  // seats sit inside the shell, where the live shadow is not read (S2): they neither cast nor receive, and
  // they live on the bowl-only layer the plaza's mirror pass skips (final review 5)
  for (const m of [seats.mesh, seats.near, patches.mesh, highlight.mesh]) m.layers.set(BOWL_LAYER);
  camera.layers.enable(BOWL_LAYER);
  camera.layers.enable(NO_REFLECT_LAYER);
  a.stadium.scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    if (o.name.startsWith("site__") || o.name.startsWith("site_mid__")) o.layers.set(NO_REFLECT_LAYER);   // v4: site_mid as the far site
    else if (/^(bowl|pitch)__/.test(o.name)) o.layers.set(BOWL_LAYER);   // behind the shell in any plaza reflection
  });
  if (a.trees) {
    setupTrees(a.trees, a.impostors, lighting.outdoor);
    a.trees.scene.traverse((o) => {          // S1: tree meshes cast; impostor billboards (shader material) do not
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = !(m.material as THREE.ShaderMaterial).isShaderMaterial; m.receiveShadow = true; m.layers.set(NO_REFLECT_LAYER); }
    });
    scene.add(a.trees.scene);
  }
  // lighter load (user 2026-09-28): the other lighting state loads only when picked (~6 MB, 1-2 s on first switch)
  const stateLoads = new Map<State, Promise<void>>();
  /** Loads a lighting state once; a failed or incomplete one is dropped so a later request retries it. */
  const loadState = (s: State) => {
    if (lighting.ready(s)) return Promise.resolve();
    let p = stateLoads.get(s);
    if (!p) {
      p = runJobs(stateJobs(a.manifest, L, s), () => {}).then((out) => {
        const st = collectState(a.manifest, s, out);
        const gaps = useLightmaps ? missingLightmaps({ [s]: st.lightmaps }, glbGroups) : [];
        if (gaps.length) throw new Error(`incomplete bake, missing ${gaps.join(", ")}`);
        a.lightmaps[s] = st.lightmaps; a.env[s] = st.env;
        lighting.addState(s);
      }).catch((e) => { stateLoads.delete(s); throw e; });
      stateLoads.set(s, p);
    }
    return p;
  };
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

  let app: AppState = { ...initialState, lighting: startState, inside: isInside(rig.pose().eye) };
  const seatPose = (r: SeatRef) => seatViewPose(dir.position(dir.find(r)));
  /** Looking at a section from above the pitch in front of it, close enough that its seats are drawn. */
  const sectionPose = (id: number): Pose => {
    const c = a.sections.sections.find((s) => Number(s.id) === id)!.centroid;
    return pivotOf({ eye: [c[0] * 0.25, c[1] * 0.25, c[2] + 20], target: c, hfov: 55 });
  };
  const syncUrl = () => {
    const u = new URL(location.href);
    if (app.view.kind === "seat") u.searchParams.set("seat", formatSeat(app.view.seat)); else u.searchParams.delete("seat");
    history.replaceState(null, "", u);
  };
  const enterSeat = (r: SeatRef, fly: boolean) => {
    rig.setMode("look");
    if (fly) rig.flyTo(seatPose(r), SEAT_EXP); else rig.jump(seatPose(r), SEAT_EXP);
  };
  const syncHighlight = () => highlight.set(app.view.kind === "seat"
    ? [app.view.seat, app.view.extra].filter((r): r is SeatRef => !!r).map((r) => seats.matrixOf(dir.find(r))) : null);
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "seat" && app.view.kind === "seat" && !(prev.view.kind === "seat" && sameSeat(prev.view.seat, app.view.seat))) {
      controls.clearCamera(); enterSeat(app.view.seat, true);
    }
    if (act.type === "back" || act.type === "camera") {
      rig.setMode("orbit");
      const name = act.type === "camera" ? act.camera : "", c = name ? a.cameras[name] : undefined;
      if (act.type === "back") controls.clearCamera();
      rig.flyTo(c ? orbitPoseOf(name, cameraPose(c)) : overview, c?.exposure ?? overviewExp);
    }
    if (act.type === "lighting") {
      const want = app.lighting;
      if (lighting.ready(want)) lighting.request(want);
      else loadState(want).then(() => { if (app.lighting === want) lighting.request(want); }, (e) => {
        console.warn(`Lighting state ${want} failed to load:`, e);
        if (app.lighting === want) dispatch({ type: "lighting", lighting: lighting.t.to });   // menu back to what is shown
      });
    }
    rig.setAutoOrbit(app.autoOrbit);
    syncHighlight();
    syncUrl();
    draw();
  };

  renderHeader(document.getElementById("header")!, a.sections.seats_total);
  const cart = () => app.view.kind === "seat" ? [app.view.seat, app.view.extra].filter((r): r is SeatRef => !!r && av.at(r) === SeatStatus.Free) : [];
  const checkout = new Checkout(document.getElementById("checkout")!, {
    paid: (bought, name, email) => {
      store.add(bought.map(({ section, row, seat, price }) => ({ section, row, seat, price, name, email, at: Date.now() })));
      av.setMine(store.all());
      if (app.view.kind === "seat" && app.view.extra) dispatch({ type: "extra", seat: null });
      draw();
    },
    closed: () => {},
  });
  const sidebar = new Sidebar(document.getElementById("sidebar")!, dir, a.sections.sections, av, () => store.all(), {
    seeView: (r, extra) => dispatch({ type: "seat", seat: r, extra }),
    section: (id) => {
      if (id === null) return;
      if (app.view.kind === "seat") dispatch({ type: "back" });
      controls.clearCamera();
      rig.setMode("orbit");
      rig.flyTo(sectionPose(id), overviewExp);
    },
    extra: (r) => dispatch({ type: "extra", seat: r }),
    buy: () => {
      const seatsInCart = cart();
      if (seatsInCart.length) checkout.open(seatsInCart.map((r) => ({ ...r, price: av.price(r), tier: tierOf.get(r.section) ?? "Lower" })));
    },
    resetTickets: () => { store.clear(); av.setMine([]); draw(); },
    hero: (cam) => dispatch({ type: "camera", camera: cam }),
    back: () => dispatch({ type: "back" }),
    copyLink: () => { navigator.clipboard?.writeText(location.href).then(() => sidebar.linkCopied(), () => {}); },
  }, heroesIn(a.cameras));
  const controls = new Controls(document.getElementById("controls")!, {
    lighting: (l) => dispatch({ type: "lighting", lighting: l }),
    reset: () => (app.view.kind === "seat" ? rig.flyTo(seatPose(app.view.seat), SEAT_EXP, rig.flying ? {} : { direct: true, seconds: ZOOM_S * 2 }) : rig.flyTo(overview, overviewExp)),
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    camera: (cam) => dispatch({ type: "camera", camera: cam }),
    autoOrbit: (on) => dispatch({ type: "autoOrbit", on }),
  });
  const draw = () => { sidebar.render(app); controls.render(app); };
  rig.onUserInput(() => { if (app.autoOrbit) dispatch({ type: "autoOrbit", on: false }); });

  // picking: section strips (always raycastable, even where seats are drawn), wall check, nearest seat to the ray
  const ray = new THREE.Raycaster(), probe = new DepthProbe(renderer);
  ray.layers.enable(BOWL_LAYER);                         // the section patches live on the bowl-only layer
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
  let hover: ReturnType<typeof toNdc> | null = null, lastHover = 0, dragging = false, hoverSection = -1;
  dom.addEventListener("pointermove", (e) => { hover = e.pointerType === "mouse" ? toNdc(e) : null; });
  dom.addEventListener("pointerdown", () => { dragging = true; hover = null; tooltip.hide(); });
  addEventListener("pointerup", () => (dragging = false));
  dom.addEventListener("pointerleave", () => { hover = null; hoverSection = -1; tooltip.hide(); });
  onClick(dom, (ndc) => {
    const i = pickSeat(ndc);
    if (i < 0) return;
    if (av.status[i] === SeatStatus.Sold) return tooltip.nudge();       // sold: no fly-to, the card shakes
    tooltip.hide();
    dispatch({ type: "seat", seat: dir.ref(i) });
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));

  // deep link (Review Focus 1): only a real seat opens seat view; anything else is the overview
  const linked = parseSeatParam(params.get("seat"));
  if (linked && dir.find(linked) >= 0) { app = reduce(app, { type: "seat", seat: linked }); enterSeat(linked, false); syncHighlight(); }
  else if (params.has("seat")) syncUrl();
  draw();

  let lastTint = "";
  const frame = (dt: number) => {
    rig.update(dt);
    const now = performance.now();
    if (rig.flying) tooltip.hide();
    else if (hover && !dragging && now - lastHover >= HOVER_MS) {
      lastHover = now;
      const h = hover, i = pickSeat(h.ndc);
      hoverSection = i >= 0 ? table.section[i] : -1;
      if (i >= 0) tooltip.show(h.x, h.y, dir.ref(i), tierOf.get(table.section[i]) ?? "Lower", av.status[i] as SeatStatus, av.price(dir.ref(i)));
      else tooltip.hide();
      hover = null;                                                          // re-pick only after the pointer moves again
    }
    const inside = isInside(toBlender(camera.position));
    if (inside !== app.inside) dispatch({ type: "inside", on: inside });
    // the chosen seat's section is kept drawn once the flight lands; forced from afar it popped in as a darker
    // block of real seats among the (lighter, averaged) section patches (user report 2026-09-27)
    const focus = app.view.kind === "seat" && !rig.flying ? app.view.seat.section : -1;
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST, focus);
    // ticketing: sold seats darken in the sections in focus (open in the sidebar, hovered, or the chosen seat's)
    const tint = new Set([sidebar.focusSection ?? -1, hoverSection, app.view.kind === "seat" ? app.view.seat.section : -1].filter((x) => x >= 0));
    const tintKey = [...tint].sort().join(",") + `|${store.all().length}`;
    if (tintKey !== lastTint) { lastTint = tintKey; seats.setStatus(av.status, tint); }
    seats.setVisibleSections(vis, nearSections(toBlender(camera.position), a.sections.sections, SEAT_NEAR_M, NEAR_SEAT_CAP));
    patches.setHidden(vis);
    highlight.update(now / 1000);
    ledUniforms.uAdTime.value += dt;
    screenFeed.update(dt);
    lighting.update(dt, rig.exposure, camera);
    sun?.update(lighting.t.night);
    mirror?.update(renderer, scene, camera, toBlender(camera.position));
    composer.render(dt);
  };

  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info, scene, flyTo: (p: Pose) => rig.flyTo(p),
    /** Resolves once the state is loaded (states stream in lazily); tick after it to finish the fade. */
    setState: (s: State) => { dispatch({ type: "lighting", lighting: s }); return loadState(s); },
    get night() { return lighting.t.night; }, tick: (dt = 1 / 60) => frame(dt),
    renderer, composer, camera, rig, lighting, stadium: a.stadium.scene, assets: a,
    get app() { return app; }, dispatch, pickSeat, pivot: pivotOf, orbitPose: orbitPoseOf,
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

  // ?dpr=fixed keeps the start pixel ratio (captures, frame-time measurements)
  const dprGov = params.get("dpr") === "fixed" ? null : new DprGovernor(renderer.getPixelRatio());
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    const dt = clock.getDelta();
    // hidden tabs throttle rAF, which would read as a slow GPU
    const lower = document.hidden ? null : dprGov?.sample(dt);
    if (lower) { renderer.setPixelRatio(lower); resize(); }
    frame(dt);
    perf.end();
  });
}

boot();
