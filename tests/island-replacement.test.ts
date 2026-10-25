import { expect, it, vi } from "vitest";
import {
  replaceIsland,
  type IslandCoordinatorContext,
} from "../src/app/island-coordinator";
import type { IslandBaseline } from "../src/world/generator.mjs";
const baseline = {} as IslandBaseline;
function context(write: () => Promise<void>) {
  return {
    islandChanging: false,
    saveCaptures: { saving: false },
    saveEpoch: 0,
    saveEnabled: true,
    store: { replaceBaseline: write },
    consumeIslandLink: vi.fn(),
    hasSave: true,
    initializeWorld: vi.fn(),
  } as unknown as IslandCoordinatorContext;
}
it("does not retire realm identity or initialize a candidate when replacement storage fails", async () => {
  const ctx = context(async () => {
      throw Error("transaction aborted");
    }),
    committed = vi.fn();
  await expect(replaceIsland(ctx, baseline, false, committed)).rejects.toThrow(
    "transaction aborted",
  );
  expect(committed).not.toHaveBeenCalled();
  expect(ctx.initializeWorld).not.toHaveBeenCalled();
  expect(ctx.consumeIslandLink).not.toHaveBeenCalled();
  expect(ctx.hasSave).toBe(true);
  expect(ctx.islandChanging).toBe(false);
});
it("changes realm ownership after the baseline transaction commits", async () => {
  const events: string[] = [],
    ctx = context(async () => {
      events.push("stored");
    }),
    committed = () => events.push("committed");
  ctx.initializeWorld = () => events.push("initialized");
  await replaceIsland(ctx, baseline, false, committed);
  expect(events).toEqual(["stored", "committed", "initialized"]);
  expect(ctx.hasSave).toBe(false);
  expect(ctx.islandChanging).toBe(false);
});
