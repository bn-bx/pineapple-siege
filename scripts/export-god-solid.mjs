/** Fill the packaged pineapple god's shell with owner-labelled voxels so breaks
 * expose solid stone. Surface voxels take the owner of the triangle crossing
 * them; outside air is flood-filled from the padded border; every enclosed
 * voxel then takes its nearest surface owner. Output is run-length encoded. */
import fs from "node:fs";
const dir = "public/assets/pineapple-god/",
  SIZE = 5,
  CLOSE = Number(process.env.CLOSE ?? 5);
const packed = JSON.parse(fs.readFileSync(dir + "mesh.json", "utf8")),
  file = fs.readFileSync(dir + "mesh.bin"),
  data = file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
  batch = packed.batches[0],
  vertices = new Float32Array(
    data,
    batch.vertices.offset,
    batch.vertices.length,
  ),
  indices = new Uint32Array(data, batch.indices.offset, batch.indices.length);
const min = [Infinity, Infinity, Infinity],
  max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vertices.length; i += 8)
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], vertices[i + k]);
    max[k] = Math.max(max[k], vertices[i + k]);
  }
// One empty voxel of padding on every side lets the outside flood surround the god.
const origin = min.map((v) => Math.floor(v / SIZE) * SIZE - SIZE),
  dims = max.map((v, k) => Math.ceil((v - origin[k]) / SIZE) + 2),
  [nx, ny] = dims,
  count = dims[0] * dims[1] * dims[2],
  label = new Uint16Array(count),
  OUTSIDE = 0xfffe,
  PEELED = 0xffff;
const voxel = (x, y, z) => {
  const i = Math.floor((x - origin[0]) / SIZE),
    j = Math.floor((y - origin[1]) / SIZE),
    k = Math.floor((z - origin[2]) / SIZE);
  return i + nx * (j + ny * k);
};
let shell = 0;
for (const chunk of batch.chunks)
  for (let t = chunk.start; t < chunk.start + chunk.count; t += 3) {
    const a = indices[t] * 8,
      b = indices[t + 1] * 8,
      c = indices[t + 2] * 8;
    const edge = Math.max(
      ...[
        [a, b],
        [b, c],
        [c, a],
      ].map(([p, q]) =>
        Math.hypot(
          vertices[p] - vertices[q],
          vertices[p + 1] - vertices[q + 1],
          vertices[p + 2] - vertices[q + 2],
        ),
      ),
    );
    // Samples at most half a voxel apart mark every voxel the triangle crosses.
    const n = Math.max(1, Math.ceil(edge / (SIZE / 2)));
    for (let i = 0; i <= n; i++)
      for (let j = 0; i + j <= n; j++) {
        const u = i / n,
          v = j / n,
          w = 1 - u - v;
        const index = voxel(
          vertices[a] * w + vertices[b] * u + vertices[c] * v,
          vertices[a + 1] * w + vertices[b + 1] * u + vertices[c + 1] * v,
          vertices[a + 2] * w + vertices[b + 2] * u + vertices[c + 2] * v,
        );
        if (!label[index]) {
          label[index] = chunk.owner + 1;
          shell++;
        }
      }
  }
const queue = new Int32Array(count);
const neighbours = function* (index) {
  const x = index % nx,
    y = Math.floor(index / nx) % ny,
    z = Math.floor(index / (nx * ny));
  if (x > 0) yield index - 1;
  if (x < nx - 1) yield index + 1;
  if (y > 0) yield index - nx;
  if (y < ny - 1) yield index + nx;
  if (z > 0) yield index - nx * ny;
  if (z < dims[2] - 1) yield index + nx * ny;
};
// Sampled surfaces can touch only at voxel corners, and the model leaves gaps
// where hidden parts meet (the figure's back against the throne). Flood the air
// around a surface thickened by CLOSE voxels, then peel the same layers back.
const barrier = new Uint8Array(count);
for (let i = 0; i < count; i++) if (label[i]) barrier[i] = 1;
for (let r = 1; r <= CLOSE; r++)
  for (let i = 0; i < count; i++)
    if (barrier[i] === r)
      for (const n of neighbours(i)) if (!barrier[n]) barrier[n] = r + 1;
let head = 0,
  tail = 0;
label[0] = OUTSIDE;
queue[tail++] = 0;
while (head < tail)
  for (const n of neighbours(queue[head++]))
    if (!label[n] && !barrier[n]) {
      label[n] = OUTSIDE;
      queue[tail++] = n;
    }
for (let r = 0; r < CLOSE; r++) {
  for (let i = 0; i < count; i++)
    if (!label[i])
      for (const n of neighbours(i))
        if (label[n] === OUTSIDE) {
          label[i] = PEELED;
          break;
        }
  for (let i = 0; i < count; i++) if (label[i] === PEELED) label[i] = OUTSIDE;
}
let outside = 0;
for (let i = 0; i < count; i++) if (label[i] === OUTSIDE) outside++;
// Grow surface owners inward so each owner's solid sits behind its own skin.
head = tail = 0;
for (let i = 0; i < count; i++)
  if (label[i] && label[i] !== OUTSIDE) queue[tail++] = i;
while (head < tail) {
  const i = queue[head++];
  for (const n of neighbours(i))
    if (!label[n]) {
      label[n] = label[i];
      queue[tail++] = n;
    }
}
const runs = [];
for (let i = 0; i < count; ) {
  const value = label[i] === OUTSIDE ? 0 : label[i];
  let length = 1;
  while (
    i + length < count &&
    length < 0xffff &&
    (label[i + length] === OUTSIDE ? 0 : label[i + length]) === value
  )
    length++;
  runs.push(value, length);
  i += length;
}
fs.writeFileSync(dir + "solid.bin", Buffer.from(new Uint16Array(runs).buffer));
fs.writeFileSync(
  dir + "solid.json",
  JSON.stringify({ revision: packed.revision, size: SIZE, origin, dims }),
);
console.log(
  `Pineapple god solid: ${dims.join(" × ")} voxels of ${SIZE} m, ${shell} surface, ` +
    `${count - outside - shell} filled, ${runs.length / 2} runs ` +
    `(${((runs.length * 2) / 1048576).toFixed(2)} MiB).`,
);
