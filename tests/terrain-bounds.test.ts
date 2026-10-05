import { expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { Terrain } from "../src/sim/terrain";

it("tightens edited bounds, invalidates shared edges and restores conservative coverage", () => {
  const base = new Float32Array(CONFIG.grid * CONFIG.grid).fill(80);
  const terrain = new Terrain(base);
  const a = [640, 60, 640],
    b = [645, 60, 645];
  expect(terrain.aboveSurface(a, b, 3)).toBe(false);
  terrain.crater(644, 644, 120, 70);
  expect(terrain.aboveSurface(a, b, 3)).toBe(true);
  expect(terrain.aboveSurface([752, 60, 644], [765, 60, 644], 3)).toBe(false);
  terrain.reset();
  expect(terrain.aboveSurface(a, b, 3)).toBe(false);
  const data: [number, number][] = [];
  for (let z = 316; z <= 328; z++)
    for (let x = 316; x <= 328; x++) data.push([z * CONFIG.grid + x, 10]);
  terrain.restore(data);
  expect(terrain.aboveSurface(a, b, 3)).toBe(true);
  // A two-meter ridge on the shared 16-meter edge must be included on both sides.
  terrain.reset();
  expect(terrain.aboveSurface([639, 90, 639], [641, 90, 641], 3)).toBe(true);
});

it("never skips a narrow ridge or edited triangle intersecting a swept segment", () => {
  const base = new Float32Array(CONFIG.grid * CONFIG.grid);
  for (let z = 290; z <= 350; z++)
    for (let x = 290; x <= 350; x++)
      base[z * CONFIG.grid + x] = ((x * 17 + z * 31) % 37) * 2;
  base[320 * CONFIG.grid + 320] = 180;
  const terrain = new Terrain(base);
  for (let n = 0; n < 600; n++) {
    const a = [600 + ((n * 19) % 85), (n * 7) % 200, 600 + ((n * 31) % 85)];
    const b = [a[0] + (n % 17) - 8, a[1] + (n % 9) - 4, a[2] + (n % 13) - 6];
    if (!terrain.aboveSurface(a, b, 3)) continue;
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      expect(a[1] + (b[1] - a[1]) * t - 3).toBeGreaterThan(
        terrain.sample(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t),
      );
    }
  }
  expect(terrain.aboveSurface([637, 120, 640], [643, 120, 640], 3)).toBe(false);
});
