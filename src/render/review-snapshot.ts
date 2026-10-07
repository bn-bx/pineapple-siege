import type { SimulationSnapshot } from "../types";
/** Inspection snapshots own a copy, never a worker's transferable pool slot. */
export function createReviewSnapshot(
  source: SimulationSnapshot,
  overrides: Partial<SimulationSnapshot>,
): SimulationSnapshot {
  return structuredClone({
    ...source,
    ...overrides,
    epoch: undefined,
    slot: undefined,
  });
}
