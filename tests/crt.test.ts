import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { normalizePreferences } from "../src/preferences";
import { Presentation } from "../src/render/presentation";
import { qualityProfile } from "../src/render/quality-profile";
import type { CRTMode } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

it("migrates CRT defaults and preserves each saved preset and unrelated settings", () => {
  expect(normalizePreferences()).toMatchObject({
    revision: 5,
    crtMode: "subtle",
  });
  expect(normalizePreferences({ revision: 4, mute: true })).toMatchObject({
    revision: 5,
    crtMode: "subtle",
    mute: true,
  });
  for (const crtMode of ["off", "subtle", "retro"] as const) {
    const p = normalizePreferences({
      crtMode,
      reduceEffects: true,
      quality: "720",
    });
    expect(normalizePreferences(p)).toMatchObject({
      crtMode,
      reduceEffects: true,
      quality: "720",
    });
  }
  for (const invalid of [null, 1, true, "unknown"]) {
    expect(normalizePreferences({ crtMode: invalid as CRTMode }).crtMode).toBe(
      "subtle",
    );
  }
});

it("bypasses CRT when off, retains composer allocations, and tracks photo and resize state", () => {
  vi.stubGlobal("Image", class {});
  const renderer = {
    getPixelRatio: () => 1,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  };
  const p = new Presentation(
    renderer as unknown as THREE.WebGLRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
  );
  const targets = [p.composer.renderTarget1, p.composer.renderTarget2];
  const setSize = vi.spyOn(p.composer, "setSize");
  for (const pass of p.composer.passes.slice(0, -1)) pass.render = vi.fn();
  const crtRender = vi.spyOn(p.crt, "render");
  const dispose = vi.spyOn(p.crt, "dispose");
  const profile = qualityProfile("1080", 0);
  p.resize(1280, 720);
  p.configure(profile, false, false);
  expect(p.crt.uniforms.resolution.value.toArray()).toEqual([1280, 720]);
  expect(p.passCount).toBe(4);
  p.render();
  expect(crtRender).toHaveBeenCalledOnce();
  expect(p.crt.renderToScreen).toBe(true);
  p.setCRTMode("off");
  p.render();
  expect(crtRender).toHaveBeenCalledOnce();
  expect(p.composer.passes.at(-2)?.renderToScreen).toBe(true);
  expect(p.passCount).toBe(3);
  for (const mode of ["retro", "subtle", "off"] as const) {
    p.setCRTMode(mode);
    p.configure(profile, true, false);
  }
  expect(setSize).toHaveBeenCalledOnce();
  expect([p.composer.renderTarget1, p.composer.renderTarget2]).toEqual(targets);
  p.setCRTMode("retro");
  p.setFocus(100);
  p.configure(profile, true, true);
  expect(p.focus.enabled).toBe(true);
  expect(p.crt.uniforms.retro.value).toBe(1);
  expect(p.passCount).toBe(5);
  p.resize(390, 760);
  p.configure(profile, true, true);
  expect(p.crt.uniforms.resolution.value.toArray()).toEqual([390, 760]);
  expect(p.crt.uniforms.retro.value).toBe(1);
  p.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
