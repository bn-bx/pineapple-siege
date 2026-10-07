import { expect, it } from "vitest";
import { OCEAN_COLOR_GLSL } from "../src/render/water-surface";

it("adds restrained animated foam only to the existing shallow-water mask", () => {
  expect(OCEAN_COLOR_GLSL).toContain(
    "float shore = (1.-smoothstep(.15,1.8,waterDepth))",
  );
  expect(OCEAN_COLOR_GLSL).toContain("float foamGrain=");
  expect(OCEAN_COLOR_GLSL).toContain("time*.72");
  expect(OCEAN_COLOR_GLSL).toContain("shore*smoothstep(.62,.9,foamGrain)*.22");
  expect(OCEAN_COLOR_GLSL).toContain(
    "outgoingLight=mix(outgoingLight,vec3(.64,.72,.7),shoreFoam)",
  );
});
