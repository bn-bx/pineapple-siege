import { expect, it } from "vitest";
import { discoActive } from "../src/disco";
import type { LaserStrike } from "../src/types";
it("keeps monster dance interruption through charge and burn, ending with the final beam", () => {
  const strike = (phase: LaserStrike["phase"]) => ({ phase }) as LaserStrike;
  expect(discoActive([])).toBe(false);
  expect(discoActive([strike("charging")])).toBe(true);
  expect(discoActive([strike("burning"), strike("finishing")])).toBe(true);
  expect(discoActive([strike("finishing")])).toBe(false);
});
