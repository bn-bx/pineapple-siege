import * as THREE from "three";

const installed = new WeakMap<THREE.Material, { detail: { value: number } }>();
/** A coherent uniform branch changes detail without new shader variants. */
export function budgetSurfaceNormals(
  material: THREE.MeshStandardMaterial,
  detail: { value: number },
) {
  const existing = installed.get(material);
  if (existing) {
    // Shared actor materials can outlive the renderer during island replacement.
    existing.detail = detail;
    return;
  }
  const state = { detail };
  installed.set(material, state);
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.uniforms.uSurfaceNormalDetail = state.detail;
    // Moving debris can inherit the source hook; avoid nesting its branch.
    if (!shader.fragmentShader.includes("uniform float uSurfaceNormalDetail;"))
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uSurfaceNormalDetail;",
        )
        .replace(
          "#include <normal_fragment_maps>",
          "if(uSurfaceNormalDetail>.5){\n#include <normal_fragment_maps>\n}",
        );
  };
  material.customProgramCacheKey = () => `${key}:surface-normal-budget-v1`;
  material.needsUpdate = true;
}
