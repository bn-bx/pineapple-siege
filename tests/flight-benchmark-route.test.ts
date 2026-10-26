import { expect, it } from "vitest";
import { flightBenchmarkRoute } from "../src/review/flight-benchmark-route";
import type { WorldData } from "../src/types";

const world = {
  size: 9216,
  castle: [4608, 100, 4608],
  sites: [],
} as unknown as WorldData;
it("chooses a repeatable clear orbit above terrain while avoiding the flight ceiling", () => {
  const route = flightBenchmarkRoute(world, (x) => (x > 4500 ? 1100 : 100));
  expect(route.p[0]).toBeLessThan(4500);
  expect(route.p[1]).toBe(900);
  expect(route.pitch).toBe(0);
  expect(flightBenchmarkRoute(world, () => 1000).p[1]).toBe(1200);
  expect(() => flightBenchmarkRoute(world, () => 1400)).toThrow(
    "No safe flight",
  );
});
