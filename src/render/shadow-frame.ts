import { Matrix4, Vector3 } from "three";

/**
 * Discrete half-extents (metres) for the sun's orthographic shadow box.
 * Fixed steps let texel snapping hold still; continuous resizing would shimmer.
 * The first step matches the original 440 m box, so ground-level flight keeps
 * its previous sharpness and caster cost.
 */
export const SHADOW_HALF_EXTENTS = [220, 320, 460, 660, 950] as const;
/**
 * From this step up, boxes cover enough ground that re-rendering them costs
 * several times the original pass; they refresh at half rate. Viewed from
 * altitude, their content is mostly static scenery.
 */
export const SHADOW_SLOW_REFRESH_EXTENT = 3;
/** Distance from the shadow-box centre to the sun camera, along the light. */
export const SHADOW_SUN_DISTANCE = 3000;
/** Covers casters behind the target plus craters and slopes below it. */
export const SHADOW_FAR = SHADOW_SUN_DISTANCE + 1600;
/** Ordinary low flight keeps the original box. */
const GROWTH_START_HEIGHT = 250;
/** Height gain in the requested half-extent per metre above that. */
const ALTITUDE_GAIN = 0.75;
/** Shrinking waits until the aircraft is this much lower than growth needed. */
const SHRINK_HYSTERESIS_HEIGHT = 60;
/** Share of the half-extent the box centre leads the aircraft along the view. */
const FORWARD_LEAD = 0.5;

/** Requested coverage before quantization. */
export function requestedShadowHalf(heightAboveGround: number) {
  return (
    SHADOW_HALF_EXTENTS[0] +
    Math.max(0, heightAboveGround - GROWTH_START_HEIGHT) * ALTITUDE_GAIN
  );
}

/**
 * Picks a step for the current altitude, capped by quality. Growing is
 * immediate; shrinking waits for a 60 m altitude margin so hovering near a
 * threshold does not resize (and re-snap) the box every frame.
 */
export function shadowExtentIndex(
  heightAboveGround: number,
  maxHalf: number,
  previous = 0,
) {
  let cap = 0;
  while (
    cap + 1 < SHADOW_HALF_EXTENTS.length &&
    SHADOW_HALF_EXTENTS[cap + 1] <= maxHalf
  )
    cap++;
  const want = requestedShadowHalf(heightAboveGround);
  const settled = requestedShadowHalf(
    heightAboveGround + SHRINK_HYSTERESIS_HEIGHT,
  );
  let index = Math.max(0, Math.min(previous, cap));
  while (index < cap && want > SHADOW_HALF_EXTENTS[index]) index++;
  while (index > 0 && settled <= SHADOW_HALF_EXTENTS[index - 1]) index--;
  return index;
}

const basis = new Matrix4(),
  origin = new Vector3(),
  up = new Vector3(0, 1, 0),
  right = new Vector3(),
  upward = new Vector3();

/**
 * Moves `center` (in place) so it lands on a whole shadow texel in the light's
 * view plane. Uses the same lookAt basis Three builds for the shadow camera,
 * including its handling of an overhead sun, so the snap matches the camera.
 */
export function snapShadowCenter(
  center: Vector3,
  lightDirection: Vector3,
  texel: number,
) {
  if (!(texel > 0)) return center;
  basis.lookAt(lightDirection, origin, up);
  right.setFromMatrixColumn(basis, 0);
  upward.setFromMatrixColumn(basis, 1);
  const u = center.dot(right),
    v = center.dot(upward);
  center
    .addScaledVector(right, Math.round(u / texel) * texel - u)
    .addScaledVector(upward, Math.round(v / texel) * texel - v);
  return center;
}

/**
 * Leads the box ahead of the aircraft along the camera's horizontal view, so
 * the visible ground gets coverage while the aircraft stays inside the box.
 */
export function leadShadowCenter(
  center: Vector3,
  viewDirection: Vector3,
  half: number,
) {
  if (half <= SHADOW_HALF_EXTENTS[0]) return center;
  // A unit view vector's horizontal part shrinks as the camera looks down:
  // looking straight down needs no lead; looking level leads the most.
  const length = Math.hypot(viewDirection.x, viewDirection.y, viewDirection.z);
  if (!(length > 0)) return center;
  const scale = (half * FORWARD_LEAD) / length;
  center.x += viewDirection.x * scale;
  center.z += viewDirection.z * scale;
  return center;
}

/**
 * Depth and normal offsets scale with texel size: larger boxes need more
 * offset to avoid acne, while the smallest box keeps the original values.
 */
export function shadowBias(texel: number) {
  const base = (SHADOW_HALF_EXTENTS[0] * 2) / 2048;
  const ratio = Math.max(1, texel / base);
  return {
    bias: (-0.00015 * Math.sqrt(ratio) * 2000) / SHADOW_FAR,
    normalBias: 0.5 * Math.min(ratio, 2.5),
  };
}

/** Radius around the camera within which an object can fall inside the box. */
export function shadowCasterReach(
  half: number,
  centerOffsetFromCamera: number,
) {
  return centerOffsetFromCamera + half * Math.SQRT2;
}
