import * as THREE from "three";

/** CPU world coordinates map to compact layers, each within common GPU limits. */
export class TerrainPages {
  readonly columns: number;
  readonly side: number;
  readonly texture: THREE.DataArrayTexture;
  readonly data: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>;
  constructor(
    readonly source: THREE.DataTexture,
    readonly grid: number,
  ) {
    this.columns = Math.ceil(grid / 2048);
    this.side = Math.ceil(grid / this.columns);
    const Type = source.type === THREE.FloatType ? Float32Array : Uint8Array;
    this.data = new Type(this.side * this.side * this.columns ** 2);
    this.texture = new THREE.DataArrayTexture(
      this.data,
      this.side,
      this.side,
      this.columns ** 2,
    );
    this.texture.format = THREE.RedFormat;
    this.texture.type = source.type;
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    source.userData.terrainPages = this;
    source.addEventListener("dispose", () => this.texture.dispose());
    this.refresh();
  }
  address(x: number, z: number) {
    const col = Math.floor(x / this.side),
      row = Math.floor(z / this.side);
    const layer = row * this.columns + col;
    const localX = x % this.side,
      localZ = z % this.side;
    return {
      layer,
      x: localX,
      z: localZ,
      index: layer * this.side ** 2 + localZ * this.side + localX,
    };
  }
  refresh() {
    const source = this.source.image.data as Float32Array | Uint8Array;
    for (let z = 0; z < this.grid; z++)
      for (let col = 0; col < this.columns; col++) {
        const x = col * this.side,
          width = Math.min(this.side, this.grid - x);
        const address = this.address(x, z);
        this.data.set(
          source.subarray(z * this.grid + x, z * this.grid + x + width),
          address.index,
        );
      }
    this.texture.layerUpdates.clear();
    this.texture.needsUpdate = true;
  }
  update(indices: Uint32Array, upload: boolean) {
    const source = this.source.image.data as Float32Array | Uint8Array;
    for (const i of indices) {
      const address = this.address(i % this.grid, Math.floor(i / this.grid));
      this.data[address.index] = source[i];
      if (upload) this.texture.addLayerUpdate(address.layer);
    }
    if (upload && indices.length) this.texture.needsUpdate = true;
  }
}

export function terrainGPUTexture(source: THREE.Texture) {
  return (
    (source.userData?.terrainPages as TerrainPages | undefined)?.texture ??
    source
  );
}
