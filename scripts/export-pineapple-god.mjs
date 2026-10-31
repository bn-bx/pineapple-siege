/** Package pineapple-god/source.glb as the destructible monument. Triangles are
 * split by role and shared among the legacy owner ordinals so entity IDs,
 * saves and the hell effigy's role filtering stay unchanged. */
import fs from "node:fs";
import crypto from "node:crypto";
import { buildPineappleGod } from "../src/world/pineapple-god.mjs";
const source = "pineapple-god/source.glb",
  out = "public/assets/pineapple-god/";
// Local placement: source units → metres, stair base at BASE_Y, throne back at BACK_Z.
const SCALE = 1030,
  BASE_Y = -6,
  BACK_Z = -230,
  MAX_EDGE = 30,
  FOUNDATION = 4;

const glb = fs.readFileSync(source),
  sourceSHA256 = crypto.createHash("sha256").update(glb).digest("hex"),
  jsonLength = glb.readUInt32LE(12),
  gltf = JSON.parse(glb.subarray(20, 20 + jsonLength)),
  binStart = 20 + jsonLength + 8;
function view(index) {
  const v = gltf.bufferViews[index],
    start = binStart + (v.byteOffset ?? 0);
  return glb.subarray(start, start + v.byteLength);
}
function accessor(index, size) {
  const a = gltf.accessors[index],
    bytes = view(a.bufferView).subarray(a.byteOffset ?? 0),
    copy = new Uint8Array(bytes.subarray(0, a.count * size * 4));
  return a.componentType === 5125
    ? new Uint32Array(copy.buffer)
    : new Float32Array(copy.buffer);
}
const primitive = gltf.meshes[0].primitives[0],
  P = accessor(primitive.attributes.POSITION, 3),
  N = accessor(primitive.attributes.NORMAL, 3),
  UV = accessor(primitive.attributes.TEXCOORD_0, 2),
  I = accessor(primitive.indices, 1),
  material = gltf.materials[primitive.material].pbrMetallicRoughness;
let yMin = Infinity,
  zMin = Infinity;
for (let i = 0; i < P.length; i += 3) {
  yMin = Math.min(yMin, P[i + 1]);
  zMin = Math.min(zMin, P[i + 2]);
}
const local = (i) => [
  P[i * 3] * SCALE,
  (P[i * 3 + 1] - yMin) * SCALE + BASE_Y,
  (P[i * 3 + 2] - zMin) * SCALE + BACK_Z,
];

// The eyelids are separate shells on the face; each becomes one reactive eye owner.
const weld = new Map(),
  vertexShell = new Int32Array(P.length / 3);
for (let i = 0; i < vertexShell.length; i++) {
  const key = [0, 1, 2].map((k) => P[i * 3 + k].toFixed(5)).join(",");
  if (!weld.has(key)) weld.set(key, weld.size);
  vertexShell[i] = weld.get(key);
}
const parent = Int32Array.from({ length: weld.size }, (_, i) => i),
  find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let t = 0; t < I.length; t += 3) {
  const a = find(vertexShell[I[t]]);
  parent[find(vertexShell[I[t + 1]])] = a;
  parent[find(vertexShell[I[t + 2]])] = a;
}
const shells = new Map();
for (let t = 0; t < I.length; t += 3) {
  const root = find(vertexShell[I[t]]);
  let s = shells.get(root);
  if (!s)
    shells.set(
      root,
      (s = { count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }),
    );
  s.count++;
  for (let j = 0; j < 3; j++)
    for (let k = 0; k < 3; k++) {
      s.min[k] = Math.min(s.min[k], P[I[t + j] * 3 + k]);
      s.max[k] = Math.max(s.max[k], P[I[t + j] * 3 + k]);
    }
}
const eyeShells = [...shells]
  .filter(
    ([, s]) =>
      s.count > 100 &&
      s.min[0] > -0.04 && s.max[0] < 0.1 &&
      s.min[1] > 0.24 && s.max[1] < 0.32 &&
      s.min[2] > -0.12 && s.max[2] < 0,
  )
  .sort((a, b) => a[1].min[0] - b[1].min[0])
  .map(([root]) => root);
if (eyeShells.length !== 2) throw Error("Expected two eye shells, found " + eyeShells.length);

// Source-space role regions, tuned against role-coloured renders.
function role(t, [x, y, z]) {
  const shell = eyeShells.indexOf(find(vertexShell[I[t]]));
  if (shell >= 0) return "eye" + shell;
  if (y < -0.39) return "stairs";
  if (Math.abs(x) > 0.255) return "figure"; // scepter, hand over the armrest
  if (z < (y < 0.27 ? -0.18 : -0.2)) return "throne"; // back and its crest
  if (x > 0.15 && y > -0.12 && z > 0) return "figure"; // hand on the armrest
  if (Math.abs(x) > 0.15 && y < 0.01) return "throne"; // armrests
  if (y > -0.01) return "figure";
  if (Math.abs(x) < 0.08 && y > -0.33 && z > 0.02) return "figure"; // loincloth
  if (Math.abs(x) < 0.22 && z > 0.068) return "figure"; // loincloth, shins, feet
  if (Math.abs(x) < 0.15 && y > -0.13) return "figure"; // lap
  return "throne";
}
const groups = new Map();
for (let t = 0; t < I.length; t += 3) {
  const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3),
    r = role(t, c),
    v = [0, 1, 2].map((j) => {
      const i = I[t + j];
      return {
        p: local(i),
        n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]],
        uv: [UV[i * 2], UV[i * 2 + 1]],
      };
    });
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(v);
}
const centre = (v) => v[0].p.map((_, k) => (v[0].p[k] + v[1].p[k] + v[2].p[k]) / 3);
// Split long faces so a hit never owns a collider spanning the throne.
for (const [r, list] of groups) {
  const split = [];
  while (list.length) {
    const v = list.pop(),
      lengths = [0, 1, 2].map((i) =>
        v[i].p.reduce((s, p, k) => s + (p - v[(i + 1) % 3].p[k]) ** 2, 0),
      ),
      edge = lengths.indexOf(Math.max(...lengths));
    if (lengths[edge] <= MAX_EDGE ** 2) {
      split.push({ v, center: centre(v) });
      continue;
    }
    const a = v[edge],
      b = v[(edge + 1) % 3],
      d = v[(edge + 2) % 3],
      n = a.n.map((x, k) => x + b.n[k]),
      length = Math.hypot(...n) || 1,
      m = {
        p: a.p.map((x, k) => (x + b.p[k]) / 2),
        n: n.map((x) => x / length),
        uv: a.uv.map((x, k) => (x + b.uv[k]) / 2),
      };
    list.push([a, m, d], [m, b, d]);
  }
  groups.set(r, split);
}

// Legacy owner layout: ordinals and roles are fixed by the original generator.
const world = JSON.parse(fs.readFileSync("public/world.json")),
  site = world.sites.find((s) => s.kind === "pineapple-god"),
  parts = [];
buildPineappleGod(site, parts, () => 0.5, () => site.p[1], false);
if (parts.length !== 829) throw Error("Unexpected legacy owner layout");
const c = Math.cos(site.yaw),
  s = Math.sin(site.yaw),
  pools = new Map();
parts.forEach((e, i) => {
  if (e.visual.role === "rock") return;
  const x = e.p[0] - site.p[0],
    z = e.p[2] - site.p[2],
    key = e.visual.role;
  if (!pools.has(key)) pools.set(key, []);
  pools.get(key).push({ i, role: key, p: [c * x - s * z, e.p[1] - site.p[1], s * x + c * z] });
});
// Co-partition triangles and owners along the longest axis so neighbours stay neighbours.
const assigned = [];
function partition(ts, os) {
  if (os.length === 1) {
    for (const t of ts) assigned.push({ ...t, owner: os[0] });
    return;
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const t of ts)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], t.center[k]);
      max[k] = Math.max(max[k], t.center[k]);
    }
  const extent = max.map((v, k) => v - min[k]),
    axis = extent.indexOf(Math.max(...extent));
  ts.sort((a, b) => a.center[axis] - b.center[axis]);
  os.sort((a, b) => a.p[axis] - b.p[axis]);
  const n = Math.floor(os.length / 2),
    cut = Math.max(n, Math.min(ts.length - (os.length - n), Math.round((ts.length * n) / os.length)));
  partition(ts.slice(0, cut), os.slice(0, n));
  partition(ts.slice(cut), os.slice(n));
}
for (const r of ["figure", "throne", "stairs"]) {
  const ts = groups.get(r),
    os = pools.get(r);
  if (!ts || ts.length < os.length) throw Error(`Too few ${r} triangles`);
  partition(ts, os.slice());
}
const eyes = pools.get("eye").slice().sort((a, b) => a.p[0] - b.p[0]);
for (const [k, owner] of eyes.entries())
  for (const t of groups.get("eye" + k)) assigned.push({ ...t, owner });

assigned.sort((a, b) => a.owner.i - b.owner.i);
const vertices = [],
  indices = [],
  lookup = new Map(),
  chunks = [],
  owners = new Map();
for (const t of assigned) {
  let o = owners.get(t.owner.i);
  if (!o) {
    owners.set(
      t.owner.i,
      (o = { ordinal: t.owner.i, role: t.owner.role, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }),
    );
    chunks.push({ owner: t.owner.i, start: indices.length, count: 0 });
  }
  chunks.at(-1).count += 3;
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
    for (let k = 0; k < 3; k++) {
      o.min[k] = Math.min(o.min[k], v.p[k]);
      o.max[k] = Math.max(o.max[k], v.p[k]);
    }
  }
}
if (owners.size !== 815) throw Error("Missing owners " + owners.size);
const vertexBytes = Buffer.from(new Float32Array(vertices).buffer),
  indexBytes = Buffer.from(new Uint32Array(indices).buffer),
  binary = Buffer.concat([vertexBytes, indexBytes]),
  revision = crypto.createHash("sha256").update(binary).digest("hex"),
  round = (v) => Math.round(v * 1000) / 1000;
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(out))
  if (name.endsWith("-surface.png")) fs.rmSync(out + name);
fs.writeFileSync(out + "mesh.bin", binary);
fs.writeFileSync(
  out + "mesh.json",
  JSON.stringify({
    revision,
    hash: revision,
    batches: [
      {
        material: {
          color: "#ffffff",
          roughness: material.roughnessFactor ?? 1,
          metalness: material.metallicFactor ?? 1,
        },
        vertices: { offset: 0, length: vertices.length },
        indices: { offset: vertexBytes.length, length: indices.length },
        chunks,
      },
    ],
  }),
);
fs.writeFileSync(
  "src/world/approved-god-manifest.json",
  JSON.stringify({
    revision,
    sourceSHA256,
    scale: SCALE,
    lift: BASE_Y,
    owners: [...owners.values()].map((o) => ({
      ordinal: o.ordinal,
      role: o.role,
      min: o.min.map(round),
      max: o.max.map(round),
      // Only owners touching the stair base anchor the support graph.
      foundation: o.min[1] < BASE_Y + FOUNDATION,
    })),
  }),
);
for (const [name, texture] of [
  ["baseColor", material.baseColorTexture],
  ["metallicRoughness", material.metallicRoughnessTexture],
]) {
  const image = gltf.images[gltf.textures[texture.index].extensions?.EXT_texture_webp?.source ?? gltf.textures[texture.index].source];
  fs.writeFileSync(`${out}${name}.webp`, view(image.bufferView));
}
const all = [...owners.values()],
  count = (r) => all.filter((o) => o.role === r).length,
  bounds = [0, 1, 2].map((k) => [Math.min(...all.map((o) => o.min[k])), Math.max(...all.map((o) => o.max[k]))]);
console.log(
  `Pineapple god ×${SCALE}: ${all.length} owners (${["figure", "throne", "stairs", "eye"].map((r) => `${r} ${count(r)}`).join(", ")}), ` +
    `${all.filter((o) => o.min[1] < BASE_Y + FOUNDATION).length} foundations, ${indices.length / 3} triangles, ` +
    `${(binary.length / 1048576).toFixed(2)} MiB, bounds ${bounds.map(([a, b]) => `${a.toFixed(0)}…${b.toFixed(0)}`).join(" × ")}.`,
);
// Fill the new shell so breaks expose solid stone.
await import("./export-god-solid.mjs");
