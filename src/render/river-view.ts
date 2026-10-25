import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { riverHalfWidth } from "../world/water-geometry.mjs";
import type { WorldData } from "../types";
import type { TerrainView } from "./terrain-view";
import { makeWaterMaterial } from "./ocean";

/** Water remains a continuous surface; procedural ripples provide its normals. */
function flattenWaterNormals(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position"),
    normals = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) normals[i * 3 + 1] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

/** Shared miters keep adjacent water reaches joined at bends without wider pools. */
export function riverCrossSections(
  points: readonly (readonly [number, number, number])[],
  width: number | readonly number[],
) {
  const direction = (from: readonly number[], to: readonly number[]) => {
    const dx = to[0] - from[0],
      dz = to[2] - from[2],
      length = Math.hypot(dx, dz) || 1;
    return [dx / length, dz / length] as const;
  };
  return points.map((point, index) => {
    const halfWidth = typeof width === "number" ? width : width[index];
    const previous =
        index > 0
          ? direction(points[index - 1], point)
          : direction(point, points[Math.min(1, points.length - 1)]),
      next =
        index + 1 < points.length
          ? direction(point, points[index + 1])
          : previous,
      previousNormal: readonly [number, number] = [-previous[1], previous[0]],
      nextNormal: readonly [number, number] = [-next[1], next[0]],
      mx = previousNormal[0] + nextNormal[0],
      mz = previousNormal[1] + nextNormal[1],
      magnitude = Math.hypot(mx, mz);
    if (magnitude < 1e-5)
      return [nextNormal[0] * halfWidth, nextNormal[1] * halfWidth] as const;
    const normalX = mx / magnitude,
      normalZ = mz / magnitude,
      projection = Math.abs(normalX * nextNormal[0] + normalZ * nextNormal[1]),
      reach = Math.min(halfWidth / Math.max(0.25, projection), halfWidth * 1.6);
    return [normalX * reach, normalZ * reach] as const;
  });
}

/** Review camera for the sharpest bend in a reach, avoiding straight-only samples. */
export function riverBendReviewCamera(
  points: readonly (readonly [number, number, number])[],
  distance = 18,
) {
  if (points.length < 3) return undefined;
  const direction = (from: readonly number[], to: readonly number[]) => {
    const dx = to[0] - from[0],
      dz = to[2] - from[2],
      length = Math.hypot(dx, dz) || 1;
    return [dx / length, dz / length] as const;
  };
  let bestIndex = -1,
    bestCurvature = 0,
    tangent: readonly [number, number] = [1, 0];
  for (let i = 1; i < points.length - 1; i++) {
    const before = direction(points[i - 1], points[i]),
      after = direction(points[i], points[i + 1]),
      alignment = before[0] * after[0] + before[1] * after[1],
      curvature = 1 - alignment;
    if (curvature <= bestCurvature) continue;
    bestIndex = i;
    bestCurvature = curvature;
    const combinedX = before[0] + after[0],
      combinedZ = before[1] + after[1],
      length = Math.hypot(combinedX, combinedZ);
    tangent = length > 1e-5 ? [combinedX / length, combinedZ / length] : after;
  }
  if (bestIndex < 0 || bestCurvature < 0.005) return undefined;
  const point = points[bestIndex],
    target: [number, number, number] = [point[0], point[1] + 0.08, point[2]],
    sideX = -tangent[1],
    sideZ = tangent[0];
  return {
    eye: [
      point[0] + sideX * distance,
      point[1] + Math.max(4, distance * 0.3),
      point[2] + sideZ * distance,
    ] as [number, number, number],
    target,
    index: bestIndex,
    curvature: bestCurvature,
  };
}

export function makeRivers(world: WorldData, terrain: TerrainView) {
  const group = new THREE.Group();
  const material =
    world.realm === "hell"
      ? new THREE.MeshStandardMaterial({
          color: "#ff6422",
          emissive: "#fa3309",
          emissiveIntensity: 2.5,
          roughness: 0.55,
          side: THREE.DoubleSide,
        })
      : makeWaterMaterial(terrain);
  if (world.realm === "hell") material.userData.time = { value: 0 };
  group.userData.material = material;
  group.userData.time = material.userData.time;
  const riverList = world.rivers ?? [],
    junctions = new Map<
      string,
      {
        p: readonly [number, number, number];
        ids: Set<string>;
        width: number;
        flow: readonly [number, number];
      }
    >();
  for (const [riverIndex, river] of riverList.entries())
    for (let i = 0; i < river.points.length; i++) {
      const point = river.points[i],
        key = `${point[0]}:${point[1]}:${point[2]}`,
        before = river.points[Math.max(0, i - 1)],
        after = river.points[Math.min(river.points.length - 1, i + 1)],
        dx = after[0] - before[0],
        dz = after[2] - before[2],
        length = Math.hypot(dx, dz) || 1;
      let join = junctions.get(key);
      if (!join)
        junctions.set(
          key,
          (join = {
            p: point,
            ids: new Set(),
            width: riverHalfWidth(river, i),
            flow: [dx / length, dz / length],
          }),
        );
      join.ids.add(river.id ?? `river-${riverIndex}`);
      join.width = Math.max(join.width, riverHalfWidth(river, i));
    }
  const tiles = new Map<number, THREE.BufferGeometry[]>();
  const append = (geometry: THREE.BufferGeometry, x: number, z: number) => {
    const key =
      Math.floor(z / 256) * Math.ceil(world.size / 256) + Math.floor(x / 256);
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(geometry);
  };
  for (const river of riverList) {
    const crossSections = riverCrossSections(
      river.points,
      river.widths ?? river.width,
    );
    // Separate reaches retain tight culling bounds and meet at shared corner pools.
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        length = Math.hypot(dx, dz);
      if (!length) continue;
      const [startX, startZ] = crossSections[i - 1],
        [endX, endZ] = crossSections[i];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            a[0] + startX,
            a[1] + 0.05,
            a[2] + startZ,
            a[0] - startX,
            a[1] + 0.05,
            a[2] - startZ,
            b[0] + endX,
            b[1] + 0.05,
            b[2] + endZ,
            b[0] - endX,
            b[1] + 0.05,
            b[2] - endZ,
          ],
          3,
        ),
      );
      const tangent = (at: number) => {
        const before = river.points[Math.max(0, at - 1)],
          after = river.points[Math.min(river.points.length - 1, at + 1)];
        const tx = after[0] - before[0],
          tz = after[2] - before[2];
        const scale = Math.hypot(tx, tz) || 1;
        return [tx / scale, tz / scale];
      };
      const startFlow = tangent(i - 1),
        endFlow = tangent(i);
      geometry.setAttribute(
        "flow",
        new THREE.Float32BufferAttribute(
          [...startFlow, ...startFlow, ...endFlow, ...endFlow],
          2,
        ),
      );
      geometry.setIndex([0, 2, 1, 1, 2, 3]);
      geometry.computeVertexNormals();
      flattenWaterNormals(geometry);
      append(geometry, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    }
  }
  // A pool is needed only where separate river reaches actually meet. Adding
  // one at every sample overlaps the strips and causes broad polygon patches.
  for (const join of junctions.values()) {
    if (join.ids.size < 2) continue;
    const pool = new THREE.CircleGeometry(join.width, 12);
    pool.deleteAttribute("uv");
    const flow = new Float32Array(pool.attributes.position.count * 2);
    for (let i = 0; i < flow.length; i += 2) {
      flow[i] = join.flow[0];
      flow[i + 1] = join.flow[1];
    }
    pool.setAttribute("flow", new THREE.BufferAttribute(flow, 2));
    pool.rotateX(-Math.PI / 2);
    flattenWaterNormals(pool);
    pool.translate(join.p[0], join.p[1] + 0.07, join.p[2]);
    append(pool, join.p[0], join.p[2]);
  }
  for (const lake of world.lakes ?? []) {
    const shape = lake.outline.map(([x, z]) => new THREE.Vector2(x, z));
    const indices = THREE.ShapeUtils.triangulateShape(shape, []).flatMap(
      ([a, b, c]) => [a, c, b],
    );
    const positions = lake.outline.flatMap(([x, z]) => [
      x,
      lake.level + 0.05,
      z,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "flow",
      new THREE.Float32BufferAttribute(new Float32Array(shape.length * 2), 2),
    );
    geometry.setIndex(indices);
    flattenWaterNormals(geometry);
    append(geometry, lake.center[0], lake.center[1]);
  }
  // Cascades use the same clipped material and residency as their parent reach.
  for (const fall of world.waterfalls ?? []) {
    const a = fall.top,
      b = fall.bottom,
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      length = Math.hypot(dx, dz) || 1;
    const nx = (-dz / length) * fall.width,
      nz = (dx / length) * fall.width;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          a[0] + nx,
          a[1] + 0.12,
          a[2] + nz,
          a[0] - nx,
          a[1] + 0.12,
          a[2] - nz,
          b[0] + nx,
          b[1] + 0.12,
          b[2] + nz,
          b[0] - nx,
          b[1] + 0.12,
          b[2] - nz,
        ],
        3,
      ),
    );
    geometry.setAttribute(
      "flow",
      new THREE.Float32BufferAttribute(
        Array.from({ length: 4 }, () => [
          (dx / length) * 2,
          (dz / length) * 2,
        ]).flat(),
        2,
      ),
    );
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.computeVertexNormals();
    append(geometry, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
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
