import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { statuePieceBox } from "../sim/statue-fracture";
import type { Vec3, WorldData } from "../types";
import type { ApprovedGodView } from "./approved-god";
import { emitFace, neighbour, stoneGeometry } from "./god-solid";

/** One broken piece: its textured skin and the stone where it broke away. */
export interface GodPiece {
  skin?: THREE.BufferGeometry;
  stone?: THREE.BufferGeometry;
  radius: number;
}
type Part = "skin" | "stone";
const CUT_BUDGET_MS = 3;

/** A growable batched draw for every flying piece of one material. */
class FlyingBatch {
  mesh?: THREE.BatchedMesh;
  constructor(
    private name: string,
    private material: () => THREE.Material | undefined,
    private scene: THREE.Scene,
  ) {}
  add(geometry: THREE.BufferGeometry) {
    const vertices = geometry.getAttribute("position").count,
      indices = geometry.index!.count;
    if (!this.mesh) {
      this.mesh = new THREE.BatchedMesh(
        256,
        Math.max(65536, vertices),
        Math.max(262144, indices),
        this.material(),
      );
      this.mesh.name = this.name;
      this.mesh.castShadow = this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    const b = this.mesh;
    if (b.unusedVertexCount < vertices || b.unusedIndexCount < indices)
      b.optimize();
    if (b.unusedVertexCount < vertices || b.unusedIndexCount < indices) {
      const used =
          b.geometry.getAttribute("position").count - b.unusedVertexCount,
        usedIndex = (b.geometry.index?.count ?? 0) - b.unusedIndexCount;
      b.setGeometrySize(
        Math.max(2 * (used + vertices), 65536),
        Math.max(2 * (usedIndex + indices), 262144),
      );
    }
    if (b.instanceCount + 1 > b.maxInstanceCount)
      b.setInstanceCount(b.maxInstanceCount * 2);
    const geometryId = b.addGeometry(geometry);
    return { geometry: geometryId, instance: b.addInstance(geometryId) };
  }
  dispose() {
    this.mesh?.removeFromParent();
    this.mesh?.dispose();
    this.mesh = undefined;
  }
}

/** Broken pineapple-god pieces drawn with the god's own textured triangles and
 * a core of the filled interior. Each owner is cut along the same aligned cells
 * the simulation used, so a piece shows exactly the patch it tore away, and its
 * broken faces match the stone left in the wound. */
export class GodDebris {
  private pieces = new Map<string, Map<number, GodPiece>>();
  private batches: Record<Part, FlyingBatch>;
  private flying = new Map<
    number,
    {
      parts: { part: Part; geometry: number; instance: number }[];
      size: number;
    }
  >();
  private placed = new Set<number>();
  private matrix = new THREE.Matrix4();
  private scale = new THREE.Vector3();
  /** Site turn and position: god-local to world. */
  private readonly frame: {
    cos: number;
    sin: number;
    ox: number;
    oy: number;
    oz: number;
  };
  /** Pieces are cut within a per-frame budget; the rest wait a frame. */
  private deadline = 0;
  constructor(
    private world: WorldData,
    private god: ApprovedGodView,
    scene: THREE.Scene,
  ) {
    const site = world.sites.find((s) => s.kind === "pineapple-god");
    const [ox, oy, oz] = site?.p ?? [0, 0, 0],
      yaw = site?.yaw ?? 0;
    this.frame = { cos: Math.cos(yaw), sin: Math.sin(yaw), ox, oy, oz };
    this.batches = {
      skin: new FlyingBatch("god-debris", () => this.material, scene),
      stone: new FlyingBatch("god-debris-stone", () => this.god.stone, scene),
    };
  }
  get material() {
    return this.god.materials[0] as THREE.MeshStandardMaterial | undefined;
  }
  /** Whether this body is drawn here rather than as a box. */
  owns(source: number, piece: number | undefined) {
    return piece !== undefined && !!this.material && this.god.refs.has(source);
  }
  private key(source: number, size: ArrayLike<number>) {
    const e = this.world.entities[source],
      refs = this.god.refs.get(source);
    if (!e || !refs) return;
    const s: Vec3 = [size[0], size[1], size[2]];
    const { n } = statuePieceBox(e.p, e.s, s, 0);
    return { e, refs, s, n, key: `${source}:${n.join("x")}` };
  }
  /** Geometry centred on the piece's original box; null when the piece holds
   * neither surface nor interior, undefined when it is not drawn here. */
  piece(
    source: number,
    piece: number,
    size: ArrayLike<number>,
  ): GodPiece | null | undefined {
    const k = this.key(source, size);
    if (!k) return;
    let pieces = this.pieces.get(k.key);
    if (!pieces)
      this.pieces.set(
        k.key,
        (pieces = this.slice(k.refs, k.e.visual?.sculptOwner, k.e, k.s, k.n)),
      );
    return pieces.get(piece) ?? null;
  }
  private slice(
    refs: NonNullable<ReturnType<ApprovedGodView["refs"]["get"]>>,
    ordinal: number | undefined,
    { p, s }: { p: Vec3; s: Vec3 },
    part: Vec3,
    n: number[],
  ) {
    const { cos, sin, ox, oy, oz } = this.frame;
    // World cell of a god-local point, on the simulation's aligned grid.
    const cellOf = (x: number, y: number, z: number) => {
      const wx = cos * x + sin * z + ox,
        wy = y + oy,
        wz = -sin * x + cos * z + oz;
      const jx = Math.floor((wx - p[0] + s[0]) / (2 * part[0])),
        jy = Math.floor((wy - p[1] + s[1]) / (2 * part[1])),
        jz = Math.floor((wz - p[2] + s[2]) / (2 * part[2]));
      return (
        Math.min(n[0] - 1, Math.max(0, jx)) +
        n[0] *
          (Math.min(n[1] - 1, Math.max(0, jy)) +
            n[1] * Math.min(n[2] - 1, Math.max(0, jz)))
      );
    };
    const centerOf = (cell: number) => {
      const { min } = statuePieceBox(p, s, part, cell);
      return [min[0] + part[0], min[1] + part[1], min[2] + part[2]];
    };
    const pieces = new Map<number, GodPiece>(),
      pieceAt = (cell: number) => {
        let piece = pieces.get(cell);
        if (!piece) pieces.set(cell, (piece = { radius: 0 }));
        return piece;
      };
    // Skin: owner triangles bucketed by centroid. Interleaved position,
    // normal, uv; all of an owner's ranges share one vertex buffer.
    const buckets = new Map<number, number[]>();
    for (const [r, ref] of refs.entries()) {
      const a = (
          ref.geometry.getAttribute(
            "position",
          ) as THREE.InterleavedBufferAttribute
        ).data.array as Float32Array,
        o = ref.original;
      for (let t = ref.start; t < ref.start + ref.count; t += 3) {
        const i = o[t] * 8,
          j = o[t + 1] * 8,
          k = o[t + 2] * 8;
        const cell = cellOf(
          (a[i] + a[j] + a[k]) / 3,
          (a[i + 1] + a[j + 1] + a[k + 1]) / 3,
          (a[i + 2] + a[j + 2] + a[k + 2]) / 3,
        );
        let list = buckets.get(cell);
        if (!list) buckets.set(cell, (list = []));
        list.push(r, t);
      }
    }
    for (const [cell, list] of buckets) {
      const [cx, cy, cz] = centerOf(cell),
        remap = new Map<number, number>(),
        positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [],
        index: number[] = [];
      for (let l = 0; l < list.length; l += 2) {
        const ref = refs[list[l]],
          a = (
            ref.geometry.getAttribute(
              "position",
            ) as THREE.InterleavedBufferAttribute
          ).data.array as Float32Array;
        for (let c = 0; c < 3; c++) {
          const v = ref.original[list[l + 1] + c],
            id = list[l] * 0x1000000 + v;
          let out = remap.get(id);
          if (out === undefined) {
            remap.set(id, (out = positions.length / 3));
            const i = v * 8;
            positions.push(
              cos * a[i] + sin * a[i + 2] + ox - cx,
              a[i + 1] + oy - cy,
              -sin * a[i] + cos * a[i + 2] + oz - cz,
            );
            normals.push(
              cos * a[i + 3] + sin * a[i + 5],
              a[i + 4],
              -sin * a[i + 3] + cos * a[i + 5],
            );
            uvs.push(a[i + 6], a[i + 7]);
          }
          index.push(out);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(index);
      geometry.computeBoundingSphere();
      pieceAt(cell).skin = geometry;
    }
    // Stone: the owner's interior voxels, faced wherever the piece broke from
    // a neighbouring piece or owner. Faces against open air stay skinned.
    const solid = this.god.solid,
      voxels = ordinal === undefined ? undefined : solid?.voxels.get(ordinal);
    if (solid && voxels) {
      const [nx, ny] = solid.dims,
        [vx, vy, vz] = solid.origin,
        size = solid.size,
        voxelCell = new Map<number, number>();
      for (const v of voxels)
        voxelCell.set(
          v,
          cellOf(
            vx + ((v % nx) + 0.5) * size,
            vy + ((Math.floor(v / nx) % ny) + 0.5) * size,
            vz + (Math.floor(v / (nx * ny)) + 0.5) * size,
          ),
        );
      const faces = new Map<number, number[]>();
      for (const [v, cell] of voxelCell)
        for (let face = 0; face < 6; face++) {
          const m = neighbour(solid, v, face);
          if (m < 0 || !solid.label[m] || voxelCell.get(m) === cell) continue;
          let list = faces.get(cell);
          if (!list) faces.set(cell, (list = []));
          list.push(v, face);
        }
      for (const [cell, list] of faces) {
        const [cx, cy, cz] = centerOf(cell),
          positions: number[] = [],
          normals: number[] = [],
          place = { cos, sin, x: ox - cx, y: oy - cy, z: oz - cz };
        for (let i = 0; i < list.length; i += 2)
          emitFace(solid, list[i], list[i + 1], positions, normals, place);
        pieceAt(cell).stone = stoneGeometry(positions, normals);
      }
    }
    for (const piece of pieces.values())
      for (const g of [piece.skin, piece.stone])
        if (g)
          piece.radius = Math.max(
            piece.radius,
            g.boundingSphere!.radius + g.boundingSphere!.center.length(),
          );
    return pieces;
  }
  /** Compiles both batched debris programs before play with one hidden
   * placeholder each; the first break would otherwise stall on shaders. */
  prewarm() {
    for (const part of ["skin", "stone"] as const) {
      const batch = this.batches[part];
      if (batch.mesh || (part === "stone" && !this.god.stone)) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(9), 3),
      );
      g.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(9), 3),
      );
      if (part === "skin")
        g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
      const { instance } = batch.add(g);
      batch.mesh!.setVisibleAt(instance, false);
      g.dispose();
    }
  }
  beginFrame() {
    this.placed.clear();
    this.deadline = performance.now() + CUT_BUDGET_MS;
  }
  /** Draws one flying piece this frame; false falls back to a box. */
  place(
    id: number,
    source: number,
    piece: number,
    size: ArrayLike<number>,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ) {
    let entry = this.flying.get(id);
    if (!entry) {
      // A large break cuts a few owners per frame; the flash hides the wait.
      const k = this.key(source, size);
      if (k && !this.pieces.has(k.key) && performance.now() > this.deadline)
        return true;
      const geometry = this.piece(source, piece, size);
      if (geometry === undefined) return false;
      entry = { parts: [], size: size[0] };
      for (const part of ["skin", "stone"] as const) {
        const g = geometry?.[part];
        if (g) entry.parts.push({ part, ...this.batches[part].add(g) });
      }
      this.flying.set(id, entry);
    }
    this.placed.add(id);
    // Expiring wreckage shrinks over its last second.
    this.matrix.compose(
      position,
      quaternion,
      this.scale.setScalar(Math.min(1, size[0] / entry.size)),
    );
    for (const { part, instance } of entry.parts) {
      const mesh = this.batches[part].mesh!;
      mesh.setVisibleAt(instance, true);
      mesh.setMatrixAt(instance, this.matrix);
    }
    return true;
  }
  /** Hides culled pieces; frees pieces that left the moving pool. */
  endFrame(present?: Set<number>) {
    for (const [id, entry] of this.flying) {
      if (present && !present.has(id)) {
        for (const { part, geometry } of entry.parts)
          this.batches[part].mesh!.deleteGeometry(geometry);
        this.flying.delete(id);
      } else if (!this.placed.has(id))
        for (const { part, instance } of entry.parts)
          this.batches[part].mesh!.setVisibleAt(instance, false);
    }
  }
  /** Static meshes for every settled god piece in a rubble batch. */
  settled(pieces: { piece: GodPiece; matrix: THREE.Matrix4 }[]) {
    const meshes: THREE.Mesh[] = [];
    for (const [part, material] of [
      ["skin", this.material],
      ["stone", this.god.stone],
    ] as const) {
      const parts = pieces.filter(({ piece }) => piece[part]);
      if (!parts.length || !material) continue;
      const merged = mergeGeometries(
        parts.map(({ piece, matrix }) =>
          piece[part]!.clone().applyMatrix4(matrix),
        ),
      );
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "settled-god-debris";
      meshes.push(mesh);
    }
    return meshes;
  }
  dispose() {
    for (const batch of Object.values(this.batches)) batch.dispose();
    this.flying.clear();
    for (const pieces of this.pieces.values())
      for (const piece of pieces.values()) {
        piece.skin?.dispose();
        piece.stone?.dispose();
      }
    this.pieces.clear();
  }
}
