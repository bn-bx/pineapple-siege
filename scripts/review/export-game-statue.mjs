/** Package the accepted sculpt without changing its vertices, UVs or normals.
 * Stable legacy owner ordinals retain existing removed-ID saves. */
import fs from "node:fs";
import crypto from "node:crypto";
import * as THREE from "three";
import { buildPineappleGod } from "../../src/world/pineapple-god.mjs";
import { sampleHeight } from "../../src/world/generator.mjs";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
const dir = "public/review/pineapple-god/",
  out = "public/assets/pineapple-god/";
const bytes = fs.readFileSync(dir + "sculpt.json"),
  asset = JSON.parse(bytes),
  approval = JSON.parse(fs.readFileSync(dir + "visual-acceptance.json"));
if (
  approval.bodyMeshRevision !== asset.meshRevision ||
  approval.approvedAssetSHA256 !==
    crypto.createHash("sha256").update(bytes).digest("hex")
)
  throw Error("Export requires the accepted sculpt");
const world = JSON.parse(fs.readFileSync("public/world.json"));
const site = world.sites.find((s) => s.kind === "pineapple-god"),
  heightBytes = fs.readFileSync("public/world.bin"),
  heights = new Float32Array(
    heightBytes.buffer.slice(
      heightBytes.byteOffset,
      heightBytes.byteOffset + heightBytes.byteLength,
    ),
  ),
  parts = [];
buildPineappleGod(
  site,
  parts,
  () => 0.5,
  (x, z) => sampleHeight(heights, x, z),
  false,
);
if (parts.length !== 829) throw Error("Unexpected legacy owner layout");
const scale = 0.9,
  lift = 15.5,
  c = Math.cos(site.yaw),
  s = Math.sin(site.yaw);
const owners = parts.map((e, i) => {
  const x = e.p[0] - site.p[0],
    z = e.p[2] - site.p[2];
  return { i, e, p: [c * x - s * z, e.p[1] - site.p[1], s * x + c * z] };
});
const family = (e) =>
  e.visual.role === "rock"
    ? "rock"
    : e.visual.role === "eye"
      ? "eye"
      : e.visual.role === "stairs"
        ? "stairs"
        : e.visual.role === "throne"
          ? "throne"
          : ["hero-head", "hero-neck"].includes(e.visual.shape)
            ? "head"
            : "figure";
const pools = new Map();
for (const o of owners) {
  const f = family(o.e);
  if (!pools.has(f)) pools.set(f, []);
  pools.get(f).push(o);
}
const triangles = new Map(),
  settings = new Map();
function add(f, t) {
  if (!triangles.has(f)) triangles.set(f, []);
  triangles.get(f).push(t);
}
for (const part of asset.parts) {
  let g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(part.vertices.flat(), 3),
  );
  g.setIndex(part.triangles.flat());
  g.computeVertexNormals();

  // Use the same crease rule as the accepted review renderer.
  if (part.region === "head") {
    const old = g;
    g = toCreasedNormals(g, 1);
    old.dispose();
  }
  const pos = g.getAttribute("position"),
    n = g.getAttribute("normal"),
    ix = g.index;
  for (let t = 0; t < part.triangles.length; t++) {
    const material = part.triangleMaterials[t],
      surface = part.uv ? (part.surface ?? "head") : null;
    const key = [surface ?? "", material].join(":");
    settings.set(key, {
      ...asset.materials[material],
      surface,
      flat: !surface,
    });
    const v = part.triangles[t].map((original, j) => {
      const a = ix ? ix.getX(t * 3 + j) : t * 3 + j;
      return {
        p: [
          pos.getX(a) * scale,
          pos.getY(a) * scale + lift,
          pos.getZ(a) * scale,
        ],
        n: [n.getX(a), n.getY(a), n.getZ(a)],
        uv: part.uv?.[original] ?? [0, 0],
        w: part.projectionWeights?.[original] ?? 0,
      };
    });
    const center = v[0].p.map(
      (_, k) => (v[0].p[k] + v[1].p[k] + v[2].p[k]) / 3,
    );
    let f =
      part.region === "head"
        ? "head"
        : part.region === "throne"
          ? part.id.startsWith("stair")
            ? "stairs"
            : "throne"
          : "figure";
    if (f === "head") {
      // Eye triangles are owned by the original two reactive eye entities.
      const uv = v.map((a) => a.uv),
        u = uv.reduce((a, b) => a + b[0], 0) / 3,
        vv = uv.reduce((a, b) => a + b[1], 0) / 3;
      const px = 460 + u * 245,
        py = 184 + (1 - vv) * 294;
      if (
        py > 280 &&
        py < 300 &&
        ((px > 534 && px < 582) || (px > 615 && px < 661))
      )
        f = "eye";
    }
    add(f, { v, center, key });
  }
  g.dispose();
}
// Subdivide only planar faces as needed for architecture damage ownership.
function subdivide(list, min) {
  while (list.length < min) {
    const next = [];
    for (const t of list) {
      const [a, b, d] = t.v;
      const mid = (x, y) => ({
        p: x.p.map((v, k) => (v + y.p[k]) / 2),
        n: new THREE.Vector3(...x.n)
          .add(new THREE.Vector3(...y.n))
          .normalize()
          .toArray(),
        uv: x.uv.map((v, k) => (v + y.uv[k]) / 2),
        w: (x.w + y.w) / 2,
      });
      const ab = mid(a, b),
        bd = mid(b, d),
        da = mid(d, a);
      for (const v of [
        [a, ab, da],
        [ab, b, bd],
        [da, bd, d],
        [ab, bd, da],
      ])
        next.push({
          ...t,
          v,
          center: v[0].p.map((_, k) => v.reduce((s, p) => s + p.p[k], 0) / 3),
        });
    }
    list = next;
  }
  return list;
}
// Split long planar faces before ownership partitioning so a staff hit does
// not acquire a collider spanning the full shaft. Linear attributes preserve
// the accepted surface, including its original interpolated normal field.
for (const [f, list] of triangles) {
  const split = [];
  const queue = list.slice();
  while (queue.length) {
    const t = queue.pop(),
      v = t.v;
    const lengths = [0, 1, 2].map((i) =>
      v[i].p.reduce((s, p, k) => s + (p - v[(i + 1) % 3].p[k]) ** 2, 0),
    );
    const edge = lengths.indexOf(Math.max(...lengths));
    if (lengths[edge] <= 45 ** 2) {
      split.push(t);
      continue;
    }
    const a = v[edge],
      b = v[(edge + 1) % 3],
      d = v[(edge + 2) % 3],
      m = {
        p: a.p.map((v, k) => (v + b.p[k]) / 2),
        n: a.n.map((v, k) => (v + b.n[k]) / 2),
        uv: a.uv.map((v, k) => (v + b.uv[k]) / 2),
        w: (a.w + b.w) / 2,
      };
    for (const v of [
      [a, m, d],
      [m, b, d],
    ])
      queue.push({
        ...t,
        v,
        center: v[0].p.map((_, k) => v.reduce((s, p) => s + p.p[k], 0) / 3),
      });
  }
  triangles.set(f, split);
}
const assigned = [];
function partition(ts, os) {
  if (os.length === 1) {
    for (const t of ts) assigned.push({ ...t, owner: os[0].i });
    return;
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const t of ts)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], t.center[k]);
      max[k] = Math.max(max[k], t.center[k]);
    }
  const axis = max
    .map((v, k) => v - min[k])
    .indexOf(Math.max(...max.map((v, k) => v - min[k])));
  ts.sort((a, b) => a.center[axis] - b.center[axis]);
  os.sort((a, b) => a.p[axis] - b.p[axis]);
  const n = Math.floor(os.length / 2),
    cut = Math.max(
      n,
      Math.min(
        ts.length - (os.length - n),
        Math.round((ts.length * n) / os.length),
      ),
    );
  partition(ts.slice(0, cut), os.slice(0, n));
  partition(ts.slice(cut), os.slice(n));
}
for (const [f, ts] of triangles) {
  const os = pools.get(f);
  if (!os?.length) throw Error("Missing owner family " + f);
  partition(subdivide(ts, os.length * 8), os.slice());
}
const bounds = owners.map((o) => ({
  ordinal: o.i,
  role: o.e.visual.role,
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
}));
const batches = [];
const buffers = [];
let offset = 0;
function pack(array, type) {
  const data =
      type === "u32" ? new Uint32Array(array) : new Float32Array(array),
    info = { offset, length: array.length };
  const b = Buffer.from(data.buffer);
  buffers.push(b);
  offset += b.length;
  return info;
}
for (const [key, material] of settings) {
  const ts = assigned.filter((t) => t.key === key);
  if (!ts.length) continue;
  ts.sort((a, b) => a.owner - b.owner);
  const vertices = [],
    indices = [],
    lookup = new Map(),
    chunks = [];
  let last = -1;
  for (const t of ts) {
    if (t.owner !== last) {
      chunks.push({ owner: t.owner, start: indices.length, count: 0 });
      last = t.owner;
    }
    chunks.at(-1).count += 3;
    for (const v of t.v) {
      const a = [...v.p, ...v.n, ...v.uv, v.w],
        key = a.join(",");
      let i = lookup.get(key);
      if (i === undefined) {
        i = vertices.length / 9;
        vertices.push(...a);
        lookup.set(key, i);
      }
      indices.push(i);
      for (let k = 0; k < 3; k++) {
        bounds[t.owner].min[k] = Math.min(bounds[t.owner].min[k], v.p[k]);
        bounds[t.owner].max[k] = Math.max(bounds[t.owner].max[k], v.p[k]);
      }
    }
  }
  batches.push({
    material,
    vertices: pack(vertices, "f32"),
    indices: pack(indices, "u32"),
    chunks,
  });
}
const used = bounds.filter((b) => b.min.every(Number.isFinite));
if (used.length !== 815) throw Error("Missing owners " + used.length);
const binary = Buffer.concat(buffers),
  hash = crypto.createHash("sha256").update(binary).digest("hex");
fs.writeFileSync(out + "mesh.bin", binary);
fs.writeFileSync(
  out + "mesh.json",
  JSON.stringify({
    revision: hash,
    sourceRevision: asset.meshRevision,
    hash,
    batches,
  }),
);
fs.writeFileSync(
  "src/world/approved-god-manifest.json",
  JSON.stringify({
    revision: hash,
    sourceRevision: asset.meshRevision,
    sourceSHA256: approval.approvedAssetSHA256,
    scale,
    lift,
    owners: used,
  }),
);
for (const surface of ["head", "body", "cloth"])
  fs.copyFileSync(
    dir + surface + "-surface.png",
    out + surface + "-surface.png",
  );
console.log(
  `Exported ${used.length} stable owners, ${batches.length} material batches, ${(binary.length / 1048576).toFixed(1)} MiB; approved geometry unchanged.`,
);
