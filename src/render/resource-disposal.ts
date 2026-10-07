import * as THREE from "three";
/** A renderer owns shared resources once; subsystems register all attached and pooled objects. */
export class ResourceDisposal {
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private instances = new Set<THREE.InstancedMesh>();
  collect(root: THREE.Object3D) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) this.geometries.add(mesh.geometry);
      if (mesh.customDepthMaterial)
        this.materials.add(mesh.customDepthMaterial);
      if (mesh.material)
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          this.materials.add(material);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh)
        this.instances.add(mesh as THREE.InstancedMesh);
    });
  }
  dispose() {
    for (const instance of this.instances) instance.dispose();
    for (const material of this.materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) this.textures.add(value);
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture)
            this.textures.add(uniform.value);
          else if (Array.isArray(uniform.value))
            for (const value of uniform.value)
              if (value instanceof THREE.Texture) this.textures.add(value);
        }
      material.dispose();
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
