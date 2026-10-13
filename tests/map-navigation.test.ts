import { expect, it } from "vitest";
import { MapNavigation } from "../src/app/map-navigation";
import type { WorldData } from "../src/types";
const world = {
  size: 9216,
  sites: [
    { id: "castle", kind: "castle", p: [4608, 0, 2304] },
    { id: "hamlet-1", kind: "hamlet", town: true, p: [2304, 0, 4608] },
  ],
} as WorldData;
it("selects named landmarks consistently when zooming and panning", () => {
  const map = new MapNavigation();
  map.setIsland(world);
  expect(map.landmarks.map((l) => l.name)).toEqual(["Castle 1", "Town 1"]);
  expect(map.selectAt(0.5, 0.25, 0.03)?.id).toBe("castle");
  map.setZoom(2);
  map.pan(0.1, 0.1);
  const position = map.screen(map.landmarks[1].p);
  expect(map.selectAt(...position, 0.03)?.id).toBe("hamlet-1");
  expect(map.guidance([4608, 0, 4608])).toBe("Town 1 · 2.3 km · 270°");
  map.pan(100, -100);
  expect(map.center).toEqual([0.25, 0.75]);
  map.setZoom(100);
  expect(map.zoom).toBe(6);
  map.setZoom(0);
  expect(map.zoom).toBe(1);
  expect(map.center).toEqual([0.5, 0.5]);
  map.setIsland(world);
  expect(map.waypoint).toBeUndefined();
});
it("gives north and south bearings and leaves selection intact for empty map clicks", () => {
  const map = new MapNavigation();
  map.setIsland(world);
  map.selectAt(0.5, 0.25, 0.03);
  expect(map.guidance([4608, 0, 4608])).toContain("0°");
  expect(map.guidance([4608, 0, 0])).toContain("180°");
  expect(map.selectAt(1, 1, 0.03)).toBeUndefined();
  expect(map.waypoint?.id).toBe("castle");
  map.waypoint = undefined;
  expect(map.guidance([0, 0, 0])).toBe("");
});
