import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ENV_ROTATION_Y, toThree } from "./coords";
import { LightingTransition, emissionStrength, envSizeMismatch, exposure, sunColor, sunStrength, sunToward } from "./lightingState";
import { STATES, type Assets, type State } from "./loader";
import { Sky } from "./background";
import { SAIL_RE, sailEnvIntensity, specOccK, type SharedUniforms } from "./stadium";
import { clearTreeUniforms, makeTreeUniforms, updateTreeUniforms } from "./treeLight";

/**
 * Task 13b (B): bloom runs on the linear HDR scene before exposure. Measured at CAM_Aerial_SW (day, bloom
 * off): 18.6 % of pixels were above the old threshold 1.0 (sunlit sails 2-3, sky 2-3.6, specular peaks
 * up to 11.5), so the whole frame bloomed into a milky haze. The threshold now sits above the brightest
 * non-emissive radiance, so only lamps, LEDs and lit windows bloom (night peaks 50-130).
 */
export const BLOOM = { strength: 0.35, radius: 0.15, threshold: 16.0 };
/**
 * Blender renders with "AgX - Medium High Contrast"; three's AgX is the base look. The look is a contrast
 * about middle grey in AgX log space: AgX log of 0.18 is (log2(0.18) + 12.47) / 16.5 = 0.606.
 */
export const AGX_LOOK = { contrast: 1.2, pivot: 0.606 };

/** three's AgX with the look applied between the log encoding and the sigmoid (renderer.toneMapping = Custom). */
export function agxLookChunk(chunk: string, look = AGX_LOOK) {
  const agx = /vec3 AgXToneMapping\( vec3 color \) \{[\s\S]*?\n\}/.exec(chunk);
  const sig = "color = agxDefaultContrastApprox( color );";
  if (!agx || !agx[0].includes(sig) || !chunk.includes("vec3 CustomToneMapping( vec3 color ) { return color; }"))
    throw new Error("three.js tonemapping_pars_fragment changed");
  const body = agx[0].replace("vec3 AgXToneMapping(", "vec3 CustomToneMapping(")
    .replace(sig, `color = clamp( ( color - ${look.pivot.toFixed(4)} ) * ${look.contrast.toFixed(4)} + ${look.pivot.toFixed(4)}, 0.0, 1.0 );\n\t${sig}`);
  return chunk.replace("vec3 CustomToneMapping( vec3 color ) { return color; }", body);
}

/**
 * Task 13b (A): the scene pass renders into a float depth attachment. With the renderer's reversed depth
 * buffer (EXT_clip_control) that gives ~float32 relative precision at any distance, so the 1-3 cm layer
 * gaps of the site (sand -0.05, lawn/plaza -0.01, paving 0.01, asphalt 0.02-0.03, glow 0.035) stay
 * separate out to the 8 km far plane. Without a float depth texture three allocates DEPTH_COMPONENT24,
 * where reversed Z gains little. The depth is only tested, never sampled: no MSAA depth resolve.
 */
export function sceneTarget(renderer: THREE.WebGLRenderer) {
  const reversed = renderer.capabilities.reversedDepthBuffer;
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: msaaSamples(renderer.getPixelRatio()),
    resolveDepthBuffer: false,
    ...(reversed ? { depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) } : {}),
  });
}

/**
 * Fix round 1: MSAA on the one scene target. DPR >= 2 (M1 laptops) already supersamples edges, but thin
 * overlays (road lines, balustrades, truss members) still shimmer, so 2 samples there (~1.9x the colour
 * memory of the target, far below 4x at 7 Mpx); 4 samples below DPR 2.
 */
export const msaaSamples = (dpr: number) => (dpr >= 2 ? 2 : 4);

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  THREE.ShaderChunk.tonemapping_pars_fragment = agxLookChunk(THREE.ShaderChunk.tonemapping_pars_fragment);
  renderer.toneMapping = THREE.CustomToneMapping;
  const c = new EffectComposer(renderer, sceneTarget(renderer));
  c.addPass(new RenderPass(scene, camera));
  c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  const out = new OutputPass();
  // no ping-pong: RenderPass and bloom work in place on readBuffer, OutputPass draws to the canvas, so
  // without the swap the second (cloned, MSAA + float depth) target is never bound and never allocated
  out.needsSwap = false;
  c.addPass(out);
  return c;
}

export class Lighting {
  t: LightingTransition;
  /** Sun + ambient for the non-lightmapped meshes (trees, seats, patches); zero while the fallback lights are on. */
  readonly outdoor = makeTreeUniforms();
  private pmrem: Partial<Record<State, THREE.Texture>> = {};
  private sky = new Sky();
  private fallbackSun?: THREE.DirectionalLight;
  private fallbackHemi?: THREE.HemisphereLight;
  private bg = new THREE.Color();
  private shown = "";
  /** false when all env maps exist but differ in size: specular then switches to the target env, no blend. */
  private envBlend = true;
  readonly hasEnv: boolean;
  /** A5 (v2): sail skin materials, whose reflection fades at night. */
  private sails: THREE.MeshStandardMaterial[];
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private a: Assets,
              private groups: Map<string, THREE.MeshStandardMaterial[]>, private emissive: THREE.MeshStandardMaterial[], initial: State,
              public shared: SharedUniforms, readonly hasLightmaps: boolean) {
    this.t = new LightingTransition(initial);
    this.sails = [...groups.values()].flat().filter((m) => SAIL_RE.test(m.name));
    this.hasEnv = STATES.every((s) => a.env[s]);
    if (this.hasEnv) {
      const bad = envSizeMismatch(STATES.map((s) => a.env[s]!.image as { width: number; height: number }));
      if (bad) { console.warn(`Lighting: ${bad}; specular env maps will switch without blending.`); this.envBlend = false; }
    }
    this.shared.uRgbmRange.value = a.manifest.rgbmRange;
    const gen = new THREE.PMREMGenerator(renderer);
    for (const s of STATES) if (a.env[s]) this.pmrem[s] = gen.fromEquirectangular(a.env[s]!).texture;
    gen.dispose();
    if (this.hasEnv) scene.add(this.sky.mesh);
    if (!this.hasLightmaps) {                            // Review Focus 4: viewer still works before the bake
      this.fallbackHemi = new THREE.HemisphereLight(0xdfe8ff, 0x6b5a40, 1.0);
      this.fallbackSun = new THREE.DirectionalLight(0xffffff, 2.5);
      scene.add(this.fallbackHemi, this.fallbackSun);
    }
    this.update(0, 0);   // bind lightMap/envMap before the first compile, so USE_LIGHTMAP/USE_ENVMAP are set
  }
  request(s: State) { this.t.request(s); }
  update(dt: number, cameraExposure: number, camera?: THREE.Camera) {
    this.t.update(dt);
    const { from, to } = this.t, e = this.t.eased, n = this.t.night;
    const key = `${from}>${to}`;
    if (key !== this.shown) {                           // rebind the pair only when it changes
      this.shown = key;
      if (this.hasLightmaps) for (const [g, mats] of this.groups) for (const m of mats) {
        m.lightMap = this.a.lightmaps[from][g] ?? null;
        (m.userData.lmB as { value: THREE.Texture | null }).value = this.a.lightmaps[to][g] ?? null;
      }
      if (this.hasEnv) {
        const envA = this.pmrem[this.envBlend ? from : to]!;   // no blend: both samplers get the target env
        for (const mats of this.groups.values()) for (const m of mats) { m.envMap = envA; m.envMapRotation.set(0, ENV_ROTATION_Y, 0); }
        this.shared.uEnvB.value = this.pmrem[to]!;
        this.sky.setTextures(this.a.env[from]!, this.a.env[to]!);
      }
    }
    this.shared.uLmBlend.value = e;
    this.shared.uEnvBlend.value = this.envBlend ? e : 0;
    this.shared.uNight.value = n;
    this.shared.uSoK.value = specOccK(n);
    for (const m of this.sails) m.envMapIntensity = sailEnvIntensity(n);
    this.sky.setBlend(e);
    for (const m of this.emissive) m.emissiveIntensity = emissionStrength(m.userData.emDay ?? 0, m.userData.emNight ?? 0, n);
    this.renderer.toneMappingExposure = exposure(n, cameraExposure);
    if (!this.hasLightmaps) clearTreeUniforms(this.outdoor);
    else if (camera) { camera.updateMatrixWorld(); updateTreeUniforms(this.outdoor, n, camera); }
    if (this.fallbackSun) {
      this.fallbackSun.position.copy(toThree(sunToward(n))).multiplyScalar(500);
      this.fallbackSun.intensity = sunStrength(n) * 0.9;
      this.fallbackSun.color.setRGB(...sunColor(n));
      this.fallbackHemi!.intensity = 1.0 - 0.8 * n;
      this.scene.background = this.bg.setHSL(0.6, 0.4, 0.5 - 0.42 * n);
    }
  }
}
