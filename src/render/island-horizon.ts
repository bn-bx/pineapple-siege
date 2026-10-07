import * as THREE from "three";
import type { Entity, Material, WorldData } from "../types";
import { setTreeCanopyColor, treeCanopyScale } from "./tree-appearance";

interface Coverage {
  allIds: number[];
  kind: string;
  x: number;
  z: number;
  radius: number;
}
/** Whole-island silhouettes are derived views of the same destructible owners. */
export class IslandHorizon {
  readonly group = new THREE.Group();
  private camera = { value: new THREE.Vector2() };
  private detail = { value: 1200 };
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private refs = new Map<
    number,
    { mesh: THREE.InstancedMesh; index: number }
  >();
  private originals = new Map<THREE.InstancedMesh, Float32Array>();
  constructor(
    world: WorldData,
    coverage: readonly Coverage[],
    materials: Record<Material, THREE.MeshStandardMaterial>,
  ) {
    const owners = new Map<number, Coverage>();
    for (const batch of coverage)
      if (batch.kind !== "trunk")
        for (const id of batch.allIds) owners.set(id, batch);
    const lists = new Map<string, Entity[]>();
    for (const entity of world.entities) {
      if (!owners.has(entity.id) || entity.material === "window") continue;
      const key =
        entity.kind === "tree"
          ? `tree:${entity.treeSpecies ?? "pine"}`
          : entity.kind === "rock"
            ? `rock:${entity.material}`
            : entity.material;
      const list = lists.get(key) ?? [];
      list.push(entity);
      lists.set(key, list);
    }
    const dummy = new THREE.Object3D();
    const canopyColor = new THREE.Color();
    for (const [key, entities] of lists) {
      const forest = key.startsWith("tree:");
      const species = key.slice(5);
      const source = materials[entities[0].material];
      const geometry = key.startsWith("rock:")
        ? new THREE.DodecahedronGeometry(1, 0)
        : forest
          ? new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0)
          : key === "roof" || key === "slate"
            ? new THREE.ConeGeometry(Math.SQRT2, 2, 4).rotateY(Math.PI / 4)
            : new THREE.BoxGeometry(2, 2, 2);
      const material = new THREE.MeshStandardMaterial({
        color: source.color,
        map: source.map,
        roughness: 1,
      });
      const bounds = new Float32Array(entities.length * 3);
      geometry.setAttribute(
        "horizonCoverage",
        new THREE.InstancedBufferAttribute(bounds, 3),
      );
      const clip = (target: THREE.Material) => {
        const prior = target.onBeforeCompile,
          cache = target.customProgramCacheKey();
        target.onBeforeCompile = (shader, renderer) => {
          prior(shader, renderer);
          shader.uniforms.horizonCamera = this.camera;
          shader.uniforms.horizonDetail = this.detail;
          shader.vertexShader =
            `attribute vec3 horizonCoverage; uniform vec2 horizonCamera; uniform float horizonDetail;\n${shader.vertexShader}`.replace(
              /void main\s*\(\s*\)\s*\{/,
              `void main() {\nvec2 horizonOffset=horizonCoverage.xy-horizonCamera; float horizonRange=horizonDetail+horizonCoverage.z;\nif(dot(horizonOffset,horizonOffset)<horizonRange*horizonRange){gl_Position=vec4(2.,2.,2.,1.);return;}`,
            );
        };
        target.customProgramCacheKey = () =>
          `${cache}:whole-island-coverage-v1`;
      };
      clip(material);
      const mesh = new THREE.InstancedMesh(geometry, material, entities.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      const depth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        alphaTest: material.alphaTest,
        side: material.side,
        map: null,
      });
      depth.onBeforeCompile = material.onBeforeCompile;
      depth.customProgramCacheKey = material.customProgramCacheKey;
      mesh.customDepthMaterial = depth;
      entities.forEach((entity, index) => {
        const batch = owners.get(entity.id)!;
        bounds.set([batch.x, batch.z, batch.radius], index * 3);
        dummy.position.fromArray(entity.p);
        dummy.scale.fromArray(entity.s);
        dummy.rotation.set(
          0,
          entity.kind === "block" ? 0 : entity.variant * 6.28,
          0,
        );
        if (forest) {
          dummy.position.y -= entity.s[1];
          dummy.scale.fromArray(treeCanopyScale(entity));
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(
          index,
          forest
            ? setTreeCanopyColor(canopyColor, entity)
            : canopyColor.setHSL(0.12, 0.06, 0.77 + entity.variant * 0.16),
        );
        this.refs.set(entity.id, { mesh, index });
      });
      this.originals.set(
        mesh,
        (mesh.instanceMatrix.array as Float32Array).slice(),
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
  }
  setView(camera: THREE.Vector3, detailDistance: number) {
    this.camera.value.set(camera.x, camera.z);
    this.detail.value = detailDistance;
  }
  remove(id: number) {
    const ref = this.refs.get(id);
    if (!ref) return;
    ref.mesh.setMatrixAt(ref.index, this.zero);
    ref.mesh.instanceMatrix.addUpdateRange(ref.index * 16, 16);
    ref.mesh.instanceMatrix.needsUpdate = true;
  }
  restore(removed: Iterable<number>) {
    for (const [mesh, original] of this.originals) {
      (mesh.instanceMatrix.array as Float32Array).set(original);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const id of removed) this.remove(id);
  }
}
