import * as THREE from "three";

/** Match cutouts and animated vertices while retaining a shared depth/normal pass. */
export function matchPrepass(
  material: THREE.MeshDepthMaterial | THREE.MeshNormalMaterial,
) {
  let vertexSource: THREE.Material | undefined;
  let signature = "",
    vertexKey = "";
  let mask: THREE.Material["onBeforeCompile"] | undefined;
  const surface = material as typeof material & {
    map: THREE.Texture | null;
    alphaMap: THREE.Texture | null;
  };
  material.customProgramCacheKey = () =>
    `matched-prepass-v1:${material.type}:${vertexKey}`;
  material.onBeforeRender = (
    _renderer,
    _scene,
    _camera,
    _geometry,
    object,
    group,
  ) => {
    const mesh = object as THREE.Mesh;
    const source = (
      Array.isArray(mesh.material)
        ? mesh.material[
            (group as unknown as { materialIndex?: number } | null)
              ?.materialIndex ?? 0
          ]
        : mesh.material
    ) as THREE.MeshStandardMaterial;
    vertexSource =
      mesh.customDepthMaterial ?? (source.alphaTest > 0 ? source : undefined);
    vertexKey = vertexSource?.customProgramCacheKey() ?? "static";
    mask = source.userData.prepassMask;
    vertexKey += `:${source.userData.prepassMaskKey ?? ""}`;
    const map = source.alphaTest > 0 ? (source.map ?? null) : null;
    const alphaMap = source.alphaTest > 0 ? (source.alphaMap ?? null) : null;
    const next = `${map?.uuid}:${alphaMap?.uuid}:${source.alphaTest}:${source.side}:${vertexKey}`;
    if (next === signature) return;
    signature = next;
    surface.map = map;
    surface.alphaMap = alphaMap;
    material.alphaTest = source.alphaTest;
    material.side = source.side;
    material.needsUpdate = true;
  };
  material.onBeforeCompile = (shader, renderer) => {
    // Existing debris depth hooks retain packed-pose interpolation. Foliage
    // hooks retain wind/billboarding; their beauty fragment code is not used.
    const fragment = shader.fragmentShader;
    vertexSource?.onBeforeCompile(shader, renderer);
    shader.fragmentShader = fragment;
    if (material instanceof THREE.MeshNormalMaterial) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <packing>",
          `#include <common>
          #include <packing>
          #include <map_pars_fragment>
          #include <alphamap_pars_fragment>
          #include <alphatest_pars_fragment>`,
        )
        .replace(
          "#include <normal_fragment_begin>",
          `#include <map_fragment>
          #include <alphamap_fragment>
          #include <alphatest_fragment>
          #include <normal_fragment_begin>`,
        );
    }
    mask?.(shader, renderer);
  };
}

/** Transparent effects must not become opaque occluders in an auxiliary pass. */
export function withOpaquePresentation<T>(
  scene: THREE.Scene,
  render: () => T,
): T {
  const hidden: THREE.Object3D[] = [];
  scene.traverseVisible((object) => {
    if (
      !(
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      )
    )
      return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (
      materials.every(
        (material) => material.transparent && material.alphaTest === 0,
      )
    ) {
      hidden.push(object);
      object.visible = false;
    }
  });
  try {
    return render();
  } finally {
    for (const object of hidden) object.visible = true;
  }
}
