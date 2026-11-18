import { expect, it } from "vitest";
import * as THREE from "three";
import {
  makeRivers,
  riverCrossSections,
  riverCurrent,
  unfoldRiverBanks,
} from "../src/render/river-view";
import { riverBankIndex } from "../src/world/water-geometry.mjs";
import { riverChannelHeight } from "../src/world/generation-grading7.mjs";

const terrain = () =>
  ({
    heightTexture: new THREE.Texture(),
    floodTexture: new THREE.Texture(),
  }) as any;

it("runs faster and whiter on steeper reaches, and leaves pools calm", () => {
  const [poolSpeed, poolRush] = riverCurrent(0);
  const [riffleSpeed, riffleRush] = riverCurrent(0.05);
  const [rapidSpeed, rapidRush] = riverCurrent(0.4);
  expect(poolRush).toBe(0);
  expect(riffleRush).toBe(0);
  expect(rapidRush).toBeGreaterThan(0.5);
  expect(poolSpeed).toBeGreaterThan(0);
  expect(riffleSpeed).toBeGreaterThan(poolSpeed);
  expect(rapidSpeed).toBeGreaterThan(riffleSpeed);
});

it("gives every water piece a current, with still lakes and white falls", () => {
  const group = makeRivers(
    {
      rivers: [
        {
          id: "r",
          width: 8,
          points: [
            [0, 40, 0],
            [60, 40, 0],
            [70, 20, 0],
            [140, 20, 0],
          ],
        },
      ],
      lakes: [
        {
          center: [300, 300],
          radius: 30,
          level: 5,
          outline: Array.from({ length: 8 }, (_, k) => [
            300 + Math.cos((k / 8) * Math.PI * 2) * 30,
            300 + Math.sin((k / 8) * Math.PI * 2) * 30,
          ]),
        },
      ],
      waterfalls: [
        { id: "f", top: [60, 40, 0], bottom: [70, 20, 0], width: 8 },
      ],
      size: 1024,
    } as any,
    terrain(),
  );
  let still = 0,
    white = 0;
  for (const child of group.children) {
    const g = (child as THREE.Mesh).geometry,
      current = g.getAttribute("current"),
      p = g.getAttribute("position");
    expect(current.count).toBe(p.count);
    for (let i = 0; i < current.count; i++) {
      if (p.getX(i) > 250 && current.getX(i) === 0 && current.getY(i) === 0)
        still++;
      if (current.getY(i) >= 0.8) white++;
    }
  }
  expect(still).toBe(8);
  expect(white).toBeGreaterThan(8);
});

it("never folds the inner bank of a bend tighter than the river is wide", () => {
  // A quarter turn of radius 16 m on a river 20 m half-width.
  const points = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * (Math.PI / 2);
    return [Math.sin(a) * 16, 0, 16 - Math.cos(a) * 16] as [
      number,
      number,
      number,
    ];
  });
  const sections = riverCrossSections(points, 20);
  const [left, right] = unfoldRiverBanks(points, sections, 20);
  for (const side of [left, right])
    for (let i = 1; i < points.length; i++) {
      const tx = points[i][0] - points[i - 1][0],
        tz = points[i][2] - points[i - 1][2],
        ax = points[i][0] + side[i][0] - points[i - 1][0] - side[i - 1][0],
        az = points[i][2] + side[i][1] - points[i - 1][2] - side[i - 1][1];
      expect(ax * tx + az * tz).toBeGreaterThanOrEqual(-1e-6);
    }
});

it("measures distance beyond the water's edge and the level there", () => {
  const bank = riverBankIndex([
    {
      id: "r",
      width: 10,
      points: [
        [0, 30, 0],
        [200, 20, 0],
      ],
    } as any,
  ]);
  expect(bank(100, 0)?.edge).toBeCloseTo(-10);
  expect(bank(100, 0)?.level).toBeCloseTo(25);
  expect(bank(100, 15)?.edge).toBeCloseTo(5);
  expect(bank(100, 80)).toBeUndefined();
});

it("carves a rounded channel that shelves to a shallow edge", () => {
  const water = 50,
    width = 12,
    ground = 70;
  const centre = riverChannelHeight(water, width, 0, ground),
    half = riverChannelHeight(water, width, width / 2, ground),
    edge = riverChannelHeight(water, width, width - 1e-6, ground),
    land = riverChannelHeight(water, width, width + 18, ground);
  expect(centre).toBeLessThan(half);
  expect(half).toBeLessThan(edge);
  expect(water - centre).toBeGreaterThan(2.5);
  expect(water - edge).toBeCloseTo(0.3, 3);
  expect(land).toBeCloseTo(ground);
});

it("settles river water below its lower bank, downhill only, meeting its trunk", async () => {
  const { settleRiverLevels } = await import("../src/world/generator7.mjs");
  // Ground falls to the east but has a 20 m hollow between x = 100 and 160,
  // and the right bank (z < 0) sits 3 m lower than the left.
  const ground = (x: number, z: number) =>
    100 - x * 0.1 - (x > 100 && x < 160 ? 20 : 0) - (z < 0 ? 3 : 0);
  const trunk = {
    id: "trunk",
    width: 4,
    widths: Array(13).fill(4),
    points: Array.from({ length: 13 }, (_, i) => [i * 20, 999, 0]),
  };
  const tributary = {
    id: "tributary",
    width: 3,
    widths: Array(4).fill(3),
    points: [
      [200, 999, 90],
      [200, 999, 60],
      [200, 999, 30],
      [200, 999, 0],
    ],
  };
  settleRiverLevels([trunk, tributary] as any, ground);
  for (let i = 0; i < trunk.points.length; i++) {
    const [x, y] = trunk.points[i];
    expect(y).toBeLessThanOrEqual(ground(x, -1) - 0.6 + 1e-3);
    if (i) expect(y).toBeLessThanOrEqual(trunk.points[i - 1][1]);
  }
  // Past the hollow the water stays at the hollow's level instead of rising.
  expect(trunk.points[9][1]).toBeLessThanOrEqual(trunk.points[6][1]);
  expect(tributary.points.at(-1)![1]).toBe(trunk.points[10][1]);
  for (let i = 1; i < tributary.points.length; i++)
    expect(tributary.points[i][1]).toBeLessThanOrEqual(
      tributary.points[i - 1][1],
    );
});
