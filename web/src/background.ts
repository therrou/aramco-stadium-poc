import * as THREE from "three";

/**
 * Sky sphere that cross-fades two equirect HDRs, using Blender's equirect mapping (coords.ts).
 * Drawn with the view rotation only (no translation), so it never depends on the camera position
 * and cannot lag a frame behind it while flying (fix round 1).
 */
export class Sky {
  mesh: THREE.Mesh;
  private u = { uA: { value: null as THREE.Texture | null }, uB: { value: null as THREE.Texture | null }, uBlend: { value: 0 } };
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, depthWrite: false, depthTest: false, side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform sampler2D uA, uB; uniform float uBlend; varying vec3 vDir;
        vec2 uvB(vec3 d){ vec3 b = normalize(vec3(d.x, -d.z, d.y)); return vec2(atan(b.y, -b.x) / 6.2831853 + 0.5, atan(b.z, length(b.xy)) / 3.1415927 + 0.5); }
        void main(){ vec2 uv = uvB(vDir); gl_FragColor = vec4(mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uBlend), 1.); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }
  setTextures(a: THREE.Texture, b: THREE.Texture) { this.u.uA.value = a; this.u.uB.value = b; }
  setBlend(t: number) { this.u.uBlend.value = t; }
}
