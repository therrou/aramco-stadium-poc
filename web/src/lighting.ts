import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ENV_ROTATION_Y, toThree } from "./coords";
import { LightingTransition, emissionStrength, envSizeMismatch, exposure, sunColor, sunStrength, sunToward } from "./lightingState";
import { STATES, type Assets, type State } from "./loader";
import { Sky } from "./background";
import type { SharedUniforms } from "./stadium";
import { clearTreeUniforms, makeTreeUniforms, updateTreeUniforms } from "./treeLight";

export const BLOOM = { strength: 0.6, radius: 0.4, threshold: 1.0 };   // tuned in Task 14

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.AgXToneMapping;
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));
  c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  c.addPass(new OutputPass());
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
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private a: Assets,
              private groups: Map<string, THREE.MeshStandardMaterial[]>, private emissive: THREE.MeshStandardMaterial[], initial: State,
              public shared: SharedUniforms, readonly hasLightmaps: boolean) {
    this.t = new LightingTransition(initial);
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
