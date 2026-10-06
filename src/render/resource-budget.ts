import * as THREE from "three";

export function textureBytes(texture: THREE.Texture): number {
  if (texture instanceof THREE.CompressedTexture)
    return texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
  const image = texture.image as
    | { width?: number; height?: number; data?: ArrayBufferView }
    | undefined;
  const bytes =
    image?.data?.byteLength ??
    (image?.width ?? 0) *
      (image?.height ?? 0) *
      (texture.type === THREE.HalfFloatType
        ? 8
        : texture.type === THREE.FloatType
          ? 16
          : 4);
  return (
    Math.ceil(bytes * (texture.generateMipmaps ? 4 / 3 : 1)) *
    (texture instanceof THREE.CubeTexture ? 6 : 1)
  );
}

/** Estimates owned storage, not driver allocations or total system memory. */
export function sceneResources(
  scene: THREE.Scene,
  ownedTextures: Iterable<THREE.Texture> = [],
) {
  const textures = new Set<THREE.Texture>(),
    geometries = new Set<THREE.BufferGeometry>();
  const add = (value: unknown) => {
    if (value instanceof THREE.Texture) textures.add(value);
  };
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of !mesh.material
      ? []
      : Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
      Object.values(material).forEach(add);
      if (material instanceof THREE.ShaderMaterial)
        Object.values(material.uniforms).forEach((uniform) =>
          add(uniform.value),
        );
    }
  });
  for (const texture of ownedTextures) add(texture);
  add(scene.environment);
  const arrays = new Set<ArrayBufferView>();
  scene.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      arrays.add(object.instanceMatrix.array);
      if (object.instanceColor) arrays.add(object.instanceColor.array);
    }
  });
  let geometryBytes = 0;
  for (const geometry of geometries) {
    if (geometry.index) arrays.add(geometry.index.array);
    for (const attr of Object.values(geometry.attributes))
      arrays.add(
        attr instanceof THREE.InterleavedBufferAttribute
          ? attr.data.array
          : attr.array,
      );
  }
  for (const array of arrays) geometryBytes += array.byteLength;
  let residentTextureBytes = 0;
  for (const texture of textures)
    if (!texture.isRenderTargetTexture)
      residentTextureBytes += textureBytes(texture);
  return { residentTextureBytes, geometryBytes };
}
