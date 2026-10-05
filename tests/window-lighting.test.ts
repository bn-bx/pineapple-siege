import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { fractureMaterials } from "../src/render/assets";
import type { Material } from "../src/types";

it("keeps broken windows dark even when their intact material emits light", () => {
  const context = { fillStyle: "", fillRect() {} };
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  try {
    const intact = new THREE.MeshStandardMaterial({
      emissive: "#ffc077",
      emissiveIntensity: 0.9,
    });
    const fragments = fractureMaterials({ window: intact } as Record<
      Material,
      THREE.MeshStandardMaterial
    >);
    expect(fragments.window.emissiveIntensity).toBe(0);
    expect(fragments.window.emissive.getHex()).toBe(0);
    expect(intact.emissiveIntensity).toBe(0.9);
    fragments.window.map!.dispose();
    fragments.window.dispose();
    intact.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});
