import { it, expect, vi } from "vitest";
import * as THREE from "three";
import { DiscoScene } from "../src/render/disco";
it("rebinds shared asset shaders to the new island without duplicating declarations", () => {
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  try {
    const material = new THREE.MeshStandardMaterial(),
      a = new DiscoScene(),
      b = new DiscoScene();
    a.decorate(material);
    b.decorate(material);
    const shader = {
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <emissivemap_fragment>",
      uniforms: {},
    } as any;
    material.onBeforeCompile(shader, {} as any);
    expect(shader.vertexShader.match(/varying vec3 vDiscoWorld/g)).toHaveLength(
      1,
    );
    expect(shader.uniforms.uDiscoAmount).toBe(b.amount);
  } finally {
    vi.unstubAllGlobals();
  }
});
