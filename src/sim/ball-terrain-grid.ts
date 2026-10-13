/** Large spheres can use fewer triangles on smooth terrain. Keep the fine mesh
 * wherever simplification would move the surface by more than 25 cm. */
export function ballTerrainGrid(fine: Float32Array) {
  for (const spacing of [4, 2]) {
    const samples = 32 / spacing,
      side = samples + 1;
    const coarse = new Float32Array(side * side);
    for (let x = 0; x <= samples; x++)
      for (let z = 0; z <= samples; z++)
        coarse[x * side + z] = fine[x * spacing * 33 + z * spacing];
    let safe = true;
    for (let x = 0; x <= 32 && safe; x++)
      for (let z = 0; z <= 32; z++) {
        const cx = Math.min(samples - 1, Math.floor(x / spacing)),
          cz = Math.min(samples - 1, Math.floor(z / spacing));
        const u = x / spacing - cx,
          v = z / spacing - cz;
        const a = coarse[cx * side + cz],
          b = coarse[(cx + 1) * side + cz];
        const c = coarse[cx * side + cz + 1],
          d = coarse[(cx + 1) * side + cz + 1];
        const height =
          u + v <= 1
            ? a + (b - a) * u + (c - a) * v
            : d + (c - d) * (1 - u) + (b - d) * (1 - v);
        if (Math.abs(height - fine[x * 33 + z]) > 0.25) {
          safe = false;
          break;
        }
      }
    if (safe) return { samples, heights: coarse };
  }
  return { samples: 32, heights: fine };
}
