/** Versioned entry point shared by browser workers, storage and build tooling. */
import * as ps4 from "./ps4/generator.mjs";
import {
  planIsland5,
  materializeIsland5,
  validateIsland5,
} from "./generator5.mjs";
import {
  planIsland6,
  materializeIsland6,
  validateIsland6,
} from "./generator6.mjs";
import {
  planIsland7,
  materializeIsland7,
  validateIsland7,
} from "./generator7.mjs";
import { PRESETS } from "./landscape.mjs";
export { PRESETS } from "./landscape.mjs";
export const GENERATOR_VERSION = 7;
export const WORLD_VERSION = 13;
export const SIZE = 9216,
  STEP = 2,
  GRID = 4609;
export const hashFor = ps4.hashFor,
  sampleHeight = ps4.sampleHeight,
  pathIndex = ps4.pathIndex;
export function generationRequest(input) {
  const request =
    typeof input === "number"
      ? { seed: input, generatorVersion: GENERATOR_VERSION, preset: "B" }
      : { ...input };
  if (
    !Number.isInteger(request.seed) ||
    request.seed < 0 ||
    request.seed > 0xffffffff
  )
    throw Error("Island seed must be an unsigned 32-bit integer.");
  request.generatorVersion ??= GENERATOR_VERSION;
  if ([4, 6, 7].includes(request.generatorVersion)) request.preset = undefined;
  else if (request.generatorVersion === 5) {
    request.preset ??= "B";
    if (!Object.hasOwn(PRESETS, request.preset))
      throw Error("Unknown island preset.");
  } else throw Error("This island uses an older or unsupported generator.");
  return request;
}
export function parseIslandCode(code) {
  const text = code.trim().toUpperCase();
  let match = /^PS([67])-([\dA-F]{8})$/.exec(text);
  if (match)
    return generationRequest({
      generatorVersion: Number(match[1]),
      seed: parseInt(match[2], 16),
    });
  match = /^PS5-([BHRW])-([\dA-F]{8})$/.exec(text);
  if (match)
    return generationRequest({
      generatorVersion: 5,
      preset: match[1],
      seed: parseInt(match[2], 16),
    });
  match = /^PS4-([\dA-F]{8})$/.exec(text);
  if (match)
    return generationRequest({
      generatorVersion: 4,
      seed: parseInt(match[1], 16),
    });
  throw Error(
    "This seed is malformed or uses an older or unsupported layout. Enter a PS7, PS6, PS5, or PS4 island code.",
  );
}
export function parseSeedCode(code) {
  return parseIslandCode(code).seed;
}
export function seedCode(input, revision = GENERATOR_VERSION, preset = "B") {
  const request =
    typeof input === "number"
      ? { seed: input, generatorVersion: revision, preset }
      : input;
  const hex = (request.seed >>> 0).toString(16).padStart(8, "0").toUpperCase();
  return (request.generatorVersion ?? GENERATOR_VERSION) === 5
    ? `PS5-${request.preset ?? "B"}-${hex}`
    : `PS${request.generatorVersion ?? GENERATOR_VERSION}-${hex}`;
}
export function islandLink(code, base) {
  parseIslandCode(code);
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("island", code.trim().toUpperCase());
  return url.href;
}
export function baselineKey(world) {
  return `${world.generatorVersion}:${world.version}:${world.seed}:${world.generationPreset ?? ""}`;
}
export function supportedIsland(world) {
  return (
    world.size === SIZE &&
    world.grid === GRID &&
    world.step === STEP &&
    ((world.generatorVersion === 4 && world.version === 10) ||
      (world.generatorVersion === 6 && world.version === 12) ||
      (world.generatorVersion === 7 && world.version === 13) ||
      (world.generatorVersion === 5 &&
        world.version === 11 &&
        Object.hasOwn(PRESETS, world.generationPreset)))
  );
}
export function planIsland(input, report = () => {}) {
  const request = generationRequest(input);
  if (request.generatorVersion === 4)
    throw Error("PS4 seeds use the complete legacy preview.");
  return request.generatorVersion === 5
    ? planIsland5(request, report)
    : request.generatorVersion === 6
      ? planIsland6(request, report)
      : planIsland7(request, report);
}
export function materializeIsland(plan, report = () => {}) {
  return plan.request.generatorVersion === 5
    ? materializeIsland5(plan, report)
    : plan.request.generatorVersion === 6
      ? materializeIsland6(plan, report)
      : materializeIsland7(plan, report);
}
export function generateIsland(input, report = () => {}) {
  const request = generationRequest(input);
  return request.generatorVersion === 4
    ? ps4.generateIsland(request.seed, report)
    : materializeIsland(planIsland(request, report), report);
}
export function validateIsland(world, heights) {
  if (!supportedIsland(world))
    throw Error(
      "Island baseline is incomplete or uses an unsupported generator.",
    );
  return world.generatorVersion === 4
    ? ps4.validateIsland(world, heights)
    : world.generatorVersion === 5
      ? validateIsland5(world, heights)
      : world.generatorVersion === 6
        ? validateIsland6(world, heights)
        : validateIsland7(world, heights);
}
