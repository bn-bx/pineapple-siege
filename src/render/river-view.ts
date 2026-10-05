import { terrainFogVertex } from "./terrain-fog";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldData } from "../types";
import type { TerrainView } from "./terrain-view";
import { CONFIG } from "../config";

export function makeRivers(world: WorldData, terrain: TerrainView) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x439395,
    roughness: 0.24,
    metalness: 0.12,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = terrainFogVertex(shader.vertexShader);
    shader.uniforms.uTerrain = { value: terrain.heightTexture };
    shader.uniforms.uWet = { value: terrain.floodTexture };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 riverPosition;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nriverPosition=(modelMatrix*vec4(transformed,1.)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 riverPosition;uniform sampler2D uTerrain,uWet;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\nvec2 riverUV=(riverPosition.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.;if(texture2D(uWet,riverUV).r<.5 || texture2D(uTerrain,riverUV).r>=riverPosition.y)discard;`,
      );
  };
  const tiles = new Map<number, THREE.BufferGeometry[]>();
  const append = (geometry: THREE.BufferGeometry, x: number, z: number) => {
    const key = Math.floor(z / 256) * 24 + Math.floor(x / 256);
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(geometry);
  };
  for (const river of world.rivers ?? []) {
    // Separate reaches retain tight culling bounds and meet at shared corner pools.
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        length = Math.hypot(dx, dz);
      if (!length) continue;
      const nx = (-dz / length) * river.width,
        nz = (dx / length) * river.width;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            a[0] + nx,
            a[1] + 0.05,
            a[2] + nz,
            a[0] - nx,
            a[1] + 0.05,
            a[2] - nz,
            b[0] + nx,
            b[1] + 0.05,
            b[2] + nz,
            b[0] - nx,
            b[1] + 0.05,
            b[2] - nz,
          ],
          3,
        ),
      );
      geometry.setIndex([0, 2, 1, 1, 2, 3]);
      geometry.computeVertexNormals();
      append(geometry, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
      const pool = new THREE.CircleGeometry(river.width, 12);
      pool.deleteAttribute("uv");
      pool.rotateX(-Math.PI / 2);
      pool.translate(a[0], a[1] + 0.04, a[2]);
      append(pool, a[0], a[2]);
    }
  }
  for (const list of tiles.values()) {
    const geometry = mergeGeometries(list)!;
    geometry.computeBoundingSphere();
    for (const part of list) part.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}
