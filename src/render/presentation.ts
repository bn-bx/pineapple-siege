import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import type { CRTMode } from "../types";
import { CRTPass } from "./crt-pass";
import { matchPrepass, withOpaquePresentation } from "./alpha-prepass";
import type { RenderQualityProfile } from "./quality-profile";

/** Scene, antialiasing, and CRT; depth of field is allocated only for photographs. */
export class Presentation {
  readonly crt = new CRTPass();
  readonly composer: EffectComposer;
  readonly focus: BokehPass;
  readonly smaa = new SMAAPass();
  onPass?: (name: string, ms: number) => void;
  targetBytes = 0;
  private width = 1;
  private height = 1;
  private allocationKey = "";
  private focusDistance = 0;
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
    );
    this.composer.setPixelRatio(1);
    this.focus = new BokehPass(scene, camera, {
      focus: 120,
      aperture: 0.000015,
      maxblur: 0.006,
    });
    matchPrepass(
      (this.focus as unknown as { _materialDepth: THREE.MeshDepthMaterial })
        ._materialDepth,
    );
    const renderFocus = this.focus.render.bind(this.focus);
    this.focus.render = (...args) =>
      withOpaquePresentation(scene, () => renderFocus(...args));
    this.focus.enabled = false;
    const passes = [
      new RenderPass(scene, camera),
      this.focus,
      this.smaa,
      new OutputPass(),
      this.crt,
    ];
    for (const [i, pass] of passes.entries()) {
      this.composer.addPass(pass);
      const render = pass.render.bind(pass);
      pass.render = (...args) => {
        const started = performance.now();
        render(...args);
        this.onPass?.(
          ["scene", "photo", "antialias", "output", "crt"][i],
          performance.now() - started,
        );
      };
    }
  }
  get size() {
    return [this.width, this.height] as const;
  }
  get passCount() {
    return this.composer.passes.filter((p) => p.enabled).length;
  }
  resize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.allocationKey = "";
  }
  configure(_profile: RenderQualityProfile, _reduced: boolean, photo: boolean) {
    this.focus.enabled = photo && this.focusDistance > 0;
    const key = `${this.width}:${this.height}:${this.focus.enabled}`;
    if (key === this.allocationKey) return;
    this.composer.setSize(this.width, this.height);
    if (!this.focus.enabled) this.focus.setSize(1, 1);
    this.targetBytes =
      this.width * this.height * (28 + (this.focus.enabled ? 8 : 0));
    this.allocationKey = key;
  }
  setCRTMode(mode: CRTMode) {
    this.crt.setMode(mode);
  }
  setFocus(distance: number) {
    this.focusDistance = Math.max(0, distance);
    (this.focus.uniforms as Record<string, THREE.IUniform>).focus.value =
      Math.max(1, distance);
  }
  prewarm() {
    this.render();
  }
  render(dt = 0) {
    this.composer.render(dt);
  }
  dispose() {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
