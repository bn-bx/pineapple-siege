import type { ParticleDepth } from "./soft-particles";
import type { LaserStrike } from "../types";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { matchPrepass, withOpaquePresentation } from "./alpha-prepass";
import {
  qualityProfile,
  VISUAL_BUDGET,
  type RenderQualityProfile,
} from "./quality-profile";

/** AO uses half-size normal/depth buffers; the beauty image stays full resolution. */
class HalfSSAO extends SSAOPass {
  override setSize(width: number, height: number) {
    super.setSize(
      Math.max(1, Math.ceil(width / 2)),
      Math.max(1, Math.ceil(height / 2)),
    );
  }
}
export class Presentation {
  readonly composer: EffectComposer;
  private particleTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  private particleMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  readonly particleDepth: ParticleDepth = {
    texture: { value: this.particleTarget.texture },
    viewport: { value: new THREE.Vector2(1, 1) },
    range: { value: new THREE.Vector2(1, 10000) },
    enabled: { value: 0 },
  };
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private particleClear = new THREE.Color();
  readonly ao: SSAOPass;
  readonly bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    0.12,
    0.35,
    1.35,
  );
  readonly smaa = new SMAAPass();
  readonly focus: BokehPass;
  private heatPoint = new THREE.Vector3();
  readonly heat = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      heatCenters: {
        value: Array.from({ length: 8 }, () => new THREE.Vector3()),
      },
      heatCount: { value: 0 },
      heatTime: { value: 0 },
    },
    vertexShader:
      "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `uniform sampler2D tDiffuse;uniform vec3 heatCenters[8];uniform int heatCount;uniform float heatTime;varying vec2 vUv;
    void main(){vec2 shift=vec2(0.);for(int i=0;i<8;i++){if(i>=heatCount)break;vec2 d=(vUv-heatCenters[i].xy)/heatCenters[i].z;float mask=exp(-dot(d,d)*3.);shift+=vec2(sin(vUv.y*180.+heatTime*4.),cos(vUv.x*140.-heatTime*3.))*mask*.0013;}gl_FragColor=texture2D(tDiffuse,clamp(vUv+shift,vec2(.001),vec2(.999)));}`,
  });
  readonly grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, saturation: { value: 0.96 } },
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:
      "uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));gl_FragColor=vec4(mix(vec3(l),c.rgb,saturation),c.a);}",
  });
  onPass?: (name: string, ms: number) => void;
  targetBytes = 0;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private allocationKey = "";
  private width = 1;
  private height = 1;
  private photograph = false;
  private focusDistance = 0;
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    matchPrepass(this.particleMaterial);
    this.composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      }),
    );
    this.composer.renderTarget2.depthBuffer = true;
    this.composer.setPixelRatio(1);
    this.ao = new HalfSSAO(scene, camera, 1, 1, 8);
    this.ao.ssaoRenderTarget.depthBuffer = false;
    this.ao.blurRenderTarget.depthBuffer = false;
    this.bloom.renderTargetBright.depthBuffer = false;
    for (const target of [
      ...this.bloom.renderTargetsHorizontal,
      ...this.bloom.renderTargetsVertical,
    ])
      target.depthBuffer = false;
    this.ao.kernelRadius = 5;
    this.ao.minDistance = 0.002;
    this.ao.maxDistance = 0.045;
    matchPrepass(this.ao.normalMaterial);
    const renderAO = this.ao.render.bind(this.ao);
    this.ao.render = (...args) =>
      withOpaquePresentation(scene, () => renderAO(...args));
    this.focus = new BokehPass(scene, camera, {
      focus: 120,
      aperture: 0.000015,
      maxblur: 0.006,
    });
    // The runtime field is pinned to Three 0.180; its published type still
    // names the older public field used by previous revisions.
    matchPrepass(
      (this.focus as unknown as { _materialDepth: THREE.MeshDepthMaterial })
        ._materialDepth,
    );
    const renderFocus = this.focus.render.bind(this.focus);
    this.focus.render = (...args) =>
      withOpaquePresentation(scene, () => renderFocus(...args));
    for (const pass of [
      new RenderPass(scene, camera),
      this.ao,
      this.bloom,
      this.heat,
      this.grade,
      this.focus,
      this.smaa,
      new OutputPass(),
    ])
      this.composer.addPass(pass);
    this.focus.enabled = false;
    for (const [index, pass] of this.composer.passes.entries()) {
      const name = [
          "scene",
          "ao",
          "bloom",
          "heat",
          "grade",
          "photo",
          "antialias",
          "output",
        ][index],
        render = pass.render.bind(pass);
      pass.render = (...args) => {
        const started = performance.now();
        render(...args);
        this.onPass?.(name, performance.now() - started);
      };
    }
  }
  prewarm() {
    const width = this.requestedWidth,
      height = this.requestedHeight,
      focus = this.focusDistance;
    this.resize(1, 1);
    this.setFocus(120);
    this.heat.uniforms.heatCount.value = 1;
    this.configure(qualityProfile("1440"), false, true);
    this.render();
    this.heat.uniforms.heatCount.value = 0;
    this.setFocus(focus);
    this.resize(width, height);
  }
  resize(width: number, height: number) {
    this.requestedWidth = width;
    this.requestedHeight = height;
    this.allocationKey = "";
  }
  configure(profile: RenderQualityProfile, reduced: boolean, photo: boolean) {
    this.heat.enabled =
      profile.heatDistortion &&
      !reduced &&
      this.heat.uniforms.heatCount.value > 0;
    this.ao.enabled = profile.ambientOcclusion;
    this.bloom.enabled = profile.bloom && !reduced;
    this.smaa.enabled = profile.antialias;
    this.photograph = photo;
    this.focus.enabled = photo && this.focusDistance > 0;
    this.particleDepth.enabled.value =
      profile.ambientOcclusion && !reduced ? 1 : 0;
    const factor =
      20 +
      (this.particleDepth.enabled.value ? 2 : 0) +
      (this.ao.enabled ? 8 : 0) +
      (this.bloom.enabled ? 8 : 0) +
      (this.smaa.enabled ? 8 : 0) +
      (this.focus.enabled ? 8 : 0);
    const reserved =
      profile.reflectionWidth * profile.reflectionHeight * 8 +
      profile.shadowSize ** 2 * 8 +
      384 * 512 * 8;
    const budget =
      profile.height > 900
        ? (profile.height > 1080 ? 192 : 128) * 1048576
        : VISUAL_BUDGET.targetBytes;
    const scale = Math.min(
      1,
      Math.sqrt(
        (budget - reserved) /
          (this.requestedWidth * this.requestedHeight * factor),
      ),
    );
    const width = Math.max(1, Math.floor(this.requestedWidth * scale)),
      height = Math.max(1, Math.floor(this.requestedHeight * scale));
    const key = `${width}:${height}:${factor}:${+this.ao.enabled}:${+this.bloom.enabled}:${+this.focus.enabled}:${this.particleDepth.enabled.value}`;
    if (key !== this.allocationKey) {
      this.width = width;
      this.height = height;
      this.composer.setSize(width, height);
      this.particleTarget.setSize(
        this.particleDepth.enabled.value ? Math.ceil(width / 2) : 1,
        this.particleDepth.enabled.value ? Math.ceil(height / 2) : 1,
      );
      this.particleDepth.viewport.value.set(width, height);
      // Disabled effects relinquish their real targets, rather than only
      // disappearing from the diagnostic estimate.
      if (!this.ao.enabled) this.ao.setSize(1, 1);
      if (!this.bloom.enabled) this.bloom.setSize(1, 1);
      if (!this.focus.enabled) this.focus.setSize(1, 1);
      this.targetBytes = Math.ceil(width * height * factor) + 128;
      this.allocationKey = key;
    }
  }
  setHeat(
    strikes: LaserStrike[],
    camera: THREE.PerspectiveCamera,
    time: number,
  ) {
    let count = 0;
    const centers = this.heat.uniforms.heatCenters.value as THREE.Vector3[];
    for (const strike of strikes) {
      if (strike.phase !== "burning") continue;
      this.heatPoint.fromArray(strike.p);
      const distance = this.heatPoint.distanceTo(camera.position);
      this.heatPoint.project(camera);
      if (
        this.heatPoint.z > 1 ||
        Math.abs(this.heatPoint.x) > 1.2 ||
        Math.abs(this.heatPoint.y) > 1.2
      )
        continue;
      centers[count++].set(
        this.heatPoint.x * 0.5 + 0.5,
        this.heatPoint.y * 0.5 + 0.5,
        THREE.MathUtils.clamp(
          (strike.profile?.radius ?? 30) / Math.max(1, distance),
          0.015,
          0.16,
        ),
      );
      if (count === 8) break;
    }
    this.heat.uniforms.heatCount.value = count;
    this.heat.uniforms.heatTime.value = time;
  }
  get size() {
    return [this.width, this.height] as const;
  }
  setFocus(distance: number) {
    this.focusDistance = Math.max(0, distance);
    (this.focus.uniforms as Record<string, THREE.IUniform>).focus.value =
      Math.max(1, distance);
    this.focus.enabled = this.photograph && distance > 0;
  }
  render(dt = 0) {
    if (this.particleDepth.enabled.value) {
      const started = performance.now(),
        target = this.renderer.getRenderTarget(),
        override = this.scene.overrideMaterial,
        alpha = this.renderer.getClearAlpha();
      this.renderer.getClearColor(this.particleClear);
      this.particleDepth.range.value.set(this.camera.near, this.camera.far);
      try {
        this.scene.overrideMaterial = this.particleMaterial;
        this.renderer.setRenderTarget(this.particleTarget);
        this.renderer.setClearColor(0xffffff, 1);
        this.renderer.clear();
        withOpaquePresentation(this.scene, () =>
          this.renderer.render(this.scene, this.camera),
        );
      } finally {
        this.scene.overrideMaterial = override;
        this.renderer.setRenderTarget(target);
        this.renderer.setClearColor(this.particleClear, alpha);
      }
      this.onPass?.("particle-depth", performance.now() - started);
    }
    // The scene always starts in the buffer with depth; fullscreen passes share
    // the other buffer without allocating a second unused scene depth buffer.
    this.composer.writeBuffer = this.composer.renderTarget1;
    this.composer.readBuffer = this.composer.renderTarget2;
    this.composer.render(dt);
  }
  dispose() {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.particleTarget.dispose();
    this.particleMaterial.dispose();
  }
}
