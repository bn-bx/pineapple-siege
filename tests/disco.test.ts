import { it, expect, vi } from "vitest";
import * as THREE from "three";
import { DiscoScene } from "../src/render/disco";
it("keeps custom water and terrain programs distinct after decoration and world reload", () => {
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  try {
    const plain = new THREE.MeshStandardMaterial(),
      river = new THREE.MeshStandardMaterial();
    river.onBeforeCompile = (shader) => {
      shader.fragmentShader += "\n//river depth and flow";
    };
    const disco = new DiscoScene();
    disco.decorate(plain);
    disco.decorate(river);
    expect(plain.customProgramCacheKey()).not.toBe(
      river.customProgramCacheKey(),
    );
    const key = river.customProgramCacheKey();
    new DiscoScene().decorate(river);
    expect(river.customProgramCacheKey()).toBe(key);
    plain.dispose();
    river.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});
