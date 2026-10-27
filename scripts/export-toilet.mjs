/** Package the CC-BY toilet as the destructible hell portal. The seat hole is
 * scaled to the 54 m aperture; owners are damage-sized surface patches. */
import fs from "node:fs";
import crypto from "node:crypto";
import * as THREE from "three";
const dir = "toilet/",
  out = "public/assets/toilet/";
const gltf = JSON.parse(fs.readFileSync(dir + "scene.gltf")),
  bin = fs.readFileSync(dir + "scene.bin");
const APERTURE = 54,
  PATCH = 60,
  MAX_EDGE = 30,
  MAX_OWNERS = 420;
const roles = {
  ToiletSeatCover: "lid",
  ToiletSeat: "seat",
  ToiletSeatMount: "mount",
  ToiletFlushHandle: "handle",
};
function accessor(i) {
  const a = gltf.accessors[i],
    view = gltf.bufferViews[a.bufferView],
    size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
    stride = (view.byteStride ?? size * 4) / 4,
    Type = a.componentType === 5125 ? Uint32Array : Float32Array,
    data = new Type(
      bin.buffer,
      bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
      (a.count - 1) * stride + size,
    );
  return Array.from({ length: a.count }, (_, k) =>
    Array.from(data.subarray(k * stride, k * stride + size)),
  );
}
// Bake node matrices: Sketchfab's centimetre/Z-up root and the raised lid hinge.
const parts = [];
function walk(index, parent) {
  const node = gltf.nodes[index],
    matrix = new THREE.Matrix4();
  if (node.matrix) matrix.fromArray(node.matrix);
  matrix.premultiply(parent);
  if (node.mesh !== undefined) {
    const primitive = gltf.meshes[node.mesh].primitives[0],
      normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix),
      normals = accessor(primitive.attributes.NORMAL);
    parts.push({
      role: roles[node.name.replace(/_Toilet_0$/, "")] ?? "body",
      positions: accessor(primitive.attributes.POSITION).map((p) =>
        new THREE.Vector3(...p).applyMatrix4(matrix),
      ),
      normals: normals.map((n) =>
        new THREE.Vector3(...n).applyMatrix3(normalMatrix).normalize(),
      ),
      uvs: accessor(primitive.attributes.TEXCOORD_0),
      indices: accessor(primitive.indices).map((i) => i[0]),
    });
  }
  for (const child of node.children ?? []) walk(child, matrix);
}
for (const root of gltf.scenes[0].nodes) walk(root, new THREE.Matrix4());
const body = parts.find((p) => p.role === "body"),
  seat = parts.find((p) => p.role === "seat");

// Seat hole: the widest gap along the centre line, then the narrowest half-width across it.
const along = seat.positions
  .filter((p) => Math.abs(p.x) < 0.01)
  .map((p) => p.z)
  .sort((a, b) => a - b);
let gap = [0, 0];
for (let i = 1; i < along.length; i++)
  if (along[i] - along[i - 1] > gap[1] - gap[0]) gap = [along[i - 1], along[i]];
const holeZ = (gap[0] + gap[1]) / 2,
  holeHalfZ = (gap[1] - gap[0]) / 2,
  holeHalfX = Math.min(
    ...seat.positions
      .filter((p) => Math.abs(p.z - holeZ) < 0.015)
      .map((p) => Math.abs(p.x)),
  );
const scale = APERTURE / Math.min(holeHalfX, holeHalfZ);

// The water sits where the bowl wall still clears the aperture from the hole centre.
function bowlSection(y) {
  let d = Infinity,
    halfX = Infinity,
    halfZ = Infinity;
  const { positions: p, indices } = body;
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = p[indices[t + e]],
        b = p[indices[t + ((e + 1) % 3)]];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      const k = (y - a.y) / (b.y - a.y),
        x = a.x + (b.x - a.x) * k,
        z = a.z + (b.z - a.z) * k;
      if (z < gap[0] - 0.08) continue;
      d = Math.min(d, Math.hypot(x, z - holeZ));
      if (Math.abs(z - holeZ) < 0.02) halfX = Math.min(halfX, Math.abs(x));
      if (Math.abs(x) < 0.02) halfZ = Math.min(halfZ, Math.abs(z - holeZ));
    }
  return { d, halfX, halfZ };
}
const seatBottom = Math.min(...seat.positions.map((p) => p.y)),
  seatTop = Math.max(...seat.positions.map((p) => p.y));
let waterY = seatBottom;
for (let y = seatBottom - 0.0025; y > 0; y -= 0.0025) {
  if (bowlSection(y).d < APERTURE / scale) break;
  waterY = y;
}
const water = bowlSection(waterY);

// Origin: the pedestal base centre, in metres.
const base = body.positions.filter((p) => p.y < 0.01),
  baseMin = new THREE.Vector3(Infinity, 0, Infinity),
  baseMax = new THREE.Vector3(-Infinity, 0, -Infinity);
for (const p of base) {
  baseMin.min(p);
  baseMax.max(p);
}
const origin = new THREE.Vector3(0, 0, (baseMin.z + baseMax.z) / 2);
const world = (p) => p.clone().sub(origin).multiplyScalar(scale).toArray();
const pedestalTop = 0.22;
const triangles = [];
for (const part of parts)
  for (let t = 0; t < part.indices.length; t += 3) {
    const v = [0, 1, 2].map((j) => {
      const i = part.indices[t + j];
      return {
        p: world(part.positions[i]),
        n: part.normals[i].toArray(),
        uv: part.uvs[i],
      };
    });
    const center = v[0].p.map((_, k) => v.reduce((s, a) => s + a.p[k], 0) / 3);
    let role = part.role;
    if (role === "body")
      role =
        center[1] < pedestalTop * scale &&
        center[2] > (baseMin.z - origin.z - 0.01) * scale
          ? "pedestal"
          : center[2] < (gap[0] - origin.z - 0.07) * scale
            ? "tank"
            : "bowl";
    triangles.push({ v, center, role });
  }
// Split long faces so a hit never owns a collider spanning the tank.
const split = [];
while (triangles.length) {
  const t = triangles.pop(),
    v = t.v,
    lengths = [0, 1, 2].map((i) =>
      v[i].p.reduce((s, p, k) => s + (p - v[(i + 1) % 3].p[k]) ** 2, 0),
    ),
    edge = lengths.indexOf(Math.max(...lengths));
  if (lengths[edge] <= MAX_EDGE ** 2) {
    split.push(t);
    continue;
  }
  const a = v[edge],
    b = v[(edge + 1) % 3],
    d = v[(edge + 2) % 3],
    m = {
      p: a.p.map((x, k) => (x + b.p[k]) / 2),
      n: new THREE.Vector3(...a.n)
        .add(new THREE.Vector3(...b.n))
        .normalize()
        .toArray(),
      uv: a.uv.map((x, k) => (x + b.uv[k]) / 2),
    };
  for (const w of [
    [a, m, d],
    [m, b, d],
  ])
    triangles.push({
      ...t,
      v: w,
      center: w[0].p.map((_, k) => w.reduce((s, q) => s + q.p[k], 0) / 3),
    });
}
// Median-split each role until every patch fits a damage-sized box.
const owners = [];
function partition(ts, role) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const t of ts)
    for (const v of t.v)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v.p[k]);
        max[k] = Math.max(max[k], v.p[k]);
      }
  const extent = max.map((v, k) => v - min[k]),
    axis = extent.indexOf(Math.max(...extent));
  if (extent[axis] <= PATCH || ts.length < 2) {
    owners.push({ ordinal: owners.length, role, min, max, triangles: ts });
    return;
  }
  ts.sort((a, b) => a.center[axis] - b.center[axis]);
  const cut = ts.length >> 1;
  partition(ts.slice(0, cut), role);
  partition(ts.slice(cut), role);
}
for (const role of ["pedestal", "bowl", "tank", "seat", "lid", "mount", "handle"])
  partition(
    split.filter((t) => t.role === role),
    role,
  );
if (owners.length > MAX_OWNERS) throw Error("Too many owners " + owners.length);

const vertices = [],
  indices = [],
  lookup = new Map(),
  chunks = [];
for (const owner of owners) {
  chunks.push({
    owner: owner.ordinal,
    start: indices.length,
    count: owner.triangles.length * 3,
  });
  for (const t of owner.triangles)
    for (const v of t.v) {
      const a = [...v.p, ...v.n, ...v.uv],
        key = a.join(",");
      let i = lookup.get(key);
      if (i === undefined) {
        i = vertices.length / 8;
        vertices.push(...a);
        lookup.set(key, i);
      }
      indices.push(i);
    }
}
const vertexBytes = Buffer.from(new Float32Array(vertices).buffer),
  indexBytes = Buffer.from(new Uint32Array(indices).buffer),
  binary = Buffer.concat([vertexBytes, indexBytes]),
  revision = crypto.createHash("sha256").update(binary).digest("hex");
const round = (v) => Math.round(v * 1000) / 1000;
const local = (z) => round((z - origin.z) * scale);
const bounds = owners.reduce(
  (b, o) => ({
    min: b.min.map((v, k) => Math.min(v, o.min[k])),
    max: b.max.map((v, k) => Math.max(v, o.max[k])),
  }),
  { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + "mesh.bin", binary);
fs.writeFileSync(
  out + "mesh.json",
  JSON.stringify({
    revision,
    vertices: { offset: 0, length: vertices.length },
    indices: { offset: vertexBytes.length, length: indices.length },
    chunks,
  }),
);
fs.writeFileSync(
  "src/world/toilet-manifest.json",
  JSON.stringify({
    revision,
    scale: round(scale),
    hole: {
      x: 0,
      z: local(holeZ),
      halfX: round(holeHalfX * scale),
      halfZ: round(holeHalfZ * scale),
    },
    waterY: round(waterY * scale),
    waterHalf: [round(water.halfX * scale), round(water.halfZ * scale)],
    seatTop: round(seatTop * scale),
    pedestal: {
      min: [round(baseMin.x * scale), local(baseMin.z)],
      max: [round(baseMax.x * scale), local(baseMax.z)],
    },
    bounds: { min: bounds.min.map(round), max: bounds.max.map(round) },
    owners: owners.map(({ ordinal, role, min, max }) => ({
      ordinal,
      role,
      min: min.map(round),
      max: max.map(round),
    })),
  }),
);
for (const name of ["baseColor", "metallicRoughness", "normal"])
  fs.copyFileSync(
    `${dir}textures/Toilet_${name}.png`,
    `${out}${name}.png`,
  );
const count = (role) => owners.filter((o) => o.role === role).length;
console.log(
  `Toilet ×${scale.toFixed(1)}: hole ${(holeHalfX * scale).toFixed(1)}×${(holeHalfZ * scale).toFixed(1)} m, ` +
    `water ${(waterY * scale).toFixed(1)} m, seat ${(seatTop * scale).toFixed(1)} m, ` +
    `${owners.length} owners (${["pedestal", "bowl", "tank", "seat", "lid", "mount", "handle"].map((r) => `${r} ${count(r)}`).join(", ")}), ` +
    `${indices.length / 3} triangles, ${(binary.length / 1048576).toFixed(2)} MiB.`,
);
