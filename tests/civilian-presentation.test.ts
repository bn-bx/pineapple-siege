import { expect, it } from "vitest";
import * as THREE from "three";
import { CivilianView } from "../src/render/civilians";
import type { SimulationSnapshot } from "../src/types";

const snapshot = (time: number, alive: boolean) =>
  ({
    time,
    civilians: [
      { id: 0, p: [0, 10, 0], yaw: 0, alive, mood: "walk", phase: 0 },
    ],
    lasers: [],
  }) as unknown as SimulationSnapshot;
const camera = new THREE.Vector3(0, 20, 20);
function torso(view: CivilianView) {
  const mesh = view.group.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  if (mesh.count) mesh.getMatrixAt(0, matrix);
  return { count: mesh.count, matrix };
}

it("collapses new casualties on simulation time, follows excavated terrain and retires without replay", () => {
  const view = new CivilianView(1),
    alive = snapshot(1, true),
    dead = snapshot(2, false);
  view.update(dead, alive, 1, camera, 1200, undefined, () => 10);
  expect(torso(view).count).toBe(1);
  const later = snapshot(3, false);
  view.update(later, dead, 1, camera, 1200, undefined, () => 10);
  const paused = torso(view).matrix.clone();
  view.update(later, dead, 0, camera, 1200, undefined, () => 10);
  expect(torso(view).matrix.elements).toEqual(paused.elements);
  view.update(snapshot(4, false), dead, 1, camera, 1200, undefined, () => -20);
  expect(torso(view).matrix.elements[13]).toBeLessThan(paused.elements[13]);
  view.update(snapshot(8, false), alive, 1, camera);
  expect(torso(view).count).toBe(0);
  // A retained previous snapshot cannot restart the expired presentation.
  view.update(snapshot(9, false), alive, 1, camera);
  expect(torso(view).count).toBe(0);
});

it("does not replay saved casualties and clears defeat presentation on reset or restoration", () => {
  const view = new CivilianView(1),
    alive = snapshot(1, true),
    dead = snapshot(2, false);
  view.update(dead, undefined, 1, camera);
  expect(torso(view).count).toBe(0);
  view.reset();
  view.update(dead, alive, 1, camera);
  expect(torso(view).count).toBe(1);
  view.reset();
  expect(torso(view).count).toBe(0);
  view.update(dead, undefined, 1, camera);
  expect(torso(view).count).toBe(0);
  view.update(alive, dead, 1, camera);
  expect(torso(view).count).toBe(1);
  view.update(snapshot(10, false), alive, 1, camera);
  expect(torso(view).count).toBe(1);
});
it("closes shared resident eyes as a newly observed defeat settles", () => {
  const view = new CivilianView(1),
    alive = snapshot(1, true),
    dead = snapshot(1.1, false),
    eyes = view.group.children[16] as THREE.InstancedMesh,
    openMatrix = new THREE.Matrix4(),
    closedMatrix = new THREE.Matrix4(),
    openScale = new THREE.Vector3(),
    closedScale = new THREE.Vector3();

  view.update(alive, undefined, 1, camera);
  eyes.getMatrixAt(0, openMatrix);
  openScale.setFromMatrixScale(openMatrix);

  view.update(dead, alive, 1, camera);
  const settled = snapshot(1.7, false);
  view.update(settled, dead, 1, camera);
  eyes.getMatrixAt(0, closedMatrix);
  closedScale.setFromMatrixScale(closedMatrix);

  expect(openScale.y).toBeGreaterThan(0.03);
  expect(closedScale.y).toBeLessThan(openScale.y * 0.01);
  expect(eyes.count).toBe(2);
});
it("holds a settled defeat pose in the isolated review without changing worker state", () => {
  const view = new CivilianView(1),
    state = snapshot(4, true),
    eyes = view.group.children[16] as THREE.InstancedMesh,
    body = view.group.children[0] as THREE.InstancedMesh,
    eyeMatrix = new THREE.Matrix4(),
    bodyMatrix = new THREE.Matrix4(),
    eyeScale = new THREE.Vector3(),
    bodyRotation = new THREE.Quaternion();
  view.setReviewDefeat(0, true, state.time);
  view.update(state, undefined, 1, camera);
  eyes.getMatrixAt(0, eyeMatrix);
  body.getMatrixAt(0, bodyMatrix);
  eyeScale.setFromMatrixScale(eyeMatrix);
  bodyMatrix.decompose(new THREE.Vector3(), bodyRotation, new THREE.Vector3());
  expect(state.civilians[0].alive).toBe(true);
  expect(eyeScale.y).toBeLessThan(0.001);
  expect(bodyRotation.angleTo(new THREE.Quaternion())).toBeGreaterThan(1);
  view.setReviewDefeat(0, false);
  view.update(snapshot(5, true), undefined, 1, camera);
  eyes.getMatrixAt(0, eyeMatrix);
  eyeScale.setFromMatrixScale(eyeMatrix);
  expect(eyeScale.y).toBeGreaterThan(0.03);
});
it("keeps cheering hands above the head and clothing identity after culling", () => {
  const view = new CivilianView(2);
  const cheering = snapshot(1, true);
  cheering.civilians[0].mood = "cheer";
  view.update(cheering, undefined, 1, camera);
  const matrix = new THREE.Matrix4();
  const hands = view.group.children[7] as THREE.InstancedMesh;
  hands.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeGreaterThan(12.2);
  expect(hands.count).toBe(2);
  const boots = view.group.children[8] as THREE.InstancedMesh;
  expect(boots.count).toBe(2);
  const selected = snapshot(2, true);
  selected.civilians[0].p[0] = 500;
  selected.civilians.push({
    ...selected.civilians[0],
    id: 1,
    p: [0, 10, 0],
    mood: "walk",
  });
  view.update(selected, undefined, 1, camera, 120);
  const color = new THREE.Color();
  (view.group.children[0] as THREE.InstancedMesh).getColorAt(0, color);
  expect(color.getHex()).toBe(0x607e86);
  (view.group.children[1] as THREE.InstancedMesh).getColorAt(0, color);
  expect(color.getHex()).toBe(0xc99770);
});
it("animates residents' arms with walking and gives fleeing a stronger run", () => {
  const view = new CivilianView(1),
    armPose = (mood: "walk" | "flee", phase: number, arm: 2 | 3) => {
      const state = snapshot(1, true);
      state.civilians[0].mood = mood;
      state.civilians[0].phase = phase;
      view.update(state, undefined, 1, camera);
      const mesh = view.group.children[arm] as THREE.InstancedMesh,
        matrix = new THREE.Matrix4(),
        rotation = new THREE.Quaternion();
      mesh.getMatrixAt(0, matrix);
      matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
      return rotation;
    };
  const walkLeft = armPose("walk", Math.PI / 4, 2),
    walkRight = armPose("walk", Math.PI / 4, 3),
    fleeLeft = armPose("flee", Math.PI / 4, 2),
    fleeRight = armPose("flee", Math.PI / 4, 3),
    walkMotion = walkLeft.angleTo(new THREE.Quaternion()),
    fleeMotion = fleeLeft.angleTo(new THREE.Quaternion());
  expect(walkMotion).toBeGreaterThan(0.1);
  expect(walkLeft.angleTo(walkRight)).toBeGreaterThan(0.1);
  expect(fleeMotion).toBeGreaterThan(walkMotion);
  expect(fleeLeft.angleTo(fleeRight)).toBeGreaterThan(walkLeft.angleTo(walkRight));
});
it("gives mourning residents a lowered head and bowed arms", () => {
  const view = new CivilianView(1),
    walking = snapshot(1, true),
    mourning = snapshot(1, true);
  mourning.civilians[0].mood = "sad";
  view.update(walking, undefined, 1, camera);
  const normalHead = new THREE.Matrix4();
  (view.group.children[1] as THREE.InstancedMesh).getMatrixAt(0, normalHead);
  view.update(mourning, undefined, 1, camera);
  const sadHead = new THREE.Matrix4(),
    leftArm = new THREE.Matrix4(),
    rightArm = new THREE.Matrix4();
  (view.group.children[1] as THREE.InstancedMesh).getMatrixAt(0, sadHead);
  (view.group.children[2] as THREE.InstancedMesh).getMatrixAt(0, leftArm);
  (view.group.children[3] as THREE.InstancedMesh).getMatrixAt(0, rightArm);
  expect(sadHead.elements[13]).toBeLessThan(normalHead.elements[13]);
  expect(Math.abs(leftArm.elements[1])).toBeGreaterThan(0.1);
  expect(Math.sign(leftArm.elements[1])).toBe(-Math.sign(rightArm.elements[1]));
});
it("shares readable smile, frown, and fear expressions on near residents", () => {
  const view = new CivilianView(2),
    state = snapshot(1, true) as any;
  state.civilians[0].mood = "cheer";
  state.civilians.push({
    ...state.civilians[0],
    id: 1,
    p: [5, 10, 0],
    mood: "sad",
  });
  view.update(state, undefined, 1, camera);
  const expressions = view.group.children[14] as THREE.InstancedMesh,
    fearExpressions = view.group.children[15] as THREE.InstancedMesh,
    smile = new THREE.Matrix4(),
    frown = new THREE.Matrix4(),
    fear = new THREE.Matrix4(),
    eye = new THREE.Matrix4(),
    smileScale = new THREE.Vector3(),
    fearScale = new THREE.Vector3();
  expect(expressions.name).toBe("resident-expressions");
  expect(fearExpressions.name).toBe("resident-fear-expressions");
  expect(expressions.count).toBe(2);
  expect(fearExpressions.count).toBe(0);
  expressions.getMatrixAt(0, smile);
  expressions.getMatrixAt(1, frown);
  (view.group.children[6] as THREE.InstancedMesh).getMatrixAt(0, eye);
  expect(smile.elements[0]).toBeGreaterThan(0);
  expect(frown.elements[0]).toBeLessThan(0);
  expect(eye.elements[14]).toBeGreaterThan(smile.elements[14]);

  state.civilians[0].mood = "flee";
  view.update(state, undefined, 1, camera);
  expect(expressions.count).toBe(1);
  expect(fearExpressions.count).toBe(1);
  fearExpressions.getMatrixAt(0, fear);
  smileScale.setFromMatrixScale(smile);
  fearScale.setFromMatrixScale(fear);
  expect(fearScale.x).toBeLessThan(smileScale.x);
  expect(fearScale.y).toBeGreaterThan(smileScale.y);
  expect(fear.elements[14]).toBeGreaterThan(smile.elements[14]);
  view.reset();
  expect(expressions.count).toBe(0);
  expect(fearExpressions.count).toBe(0);
});
it("uses shared eye whites, widens fearful eyes and aligns headwear with bowed heads", () => {
  const view = new CivilianView(2),
    state = snapshot(1, true);
  state.civilians[0].id = 2;
  view.update(state, undefined, 1, camera);
  const eyes = view.group.children[16] as THREE.InstancedMesh,
    hair = view.group.children[12] as THREE.InstancedMesh,
    normalEye = new THREE.Matrix4(),
    normalHair = new THREE.Matrix4(),
    fearfulEye = new THREE.Matrix4(),
    bowedEye = new THREE.Matrix4(),
    bowedHair = new THREE.Matrix4(),
    normalScale = new THREE.Vector3(),
    fearScale = new THREE.Vector3();
  expect(eyes.name).toBe("resident-eye-whites");
  expect(eyes.count).toBe(2);
  eyes.getMatrixAt(0, normalEye);
  hair.getMatrixAt(0, normalHair);

  state.civilians[0].mood = "flee";
  view.update(state, undefined, 1, camera);
  eyes.getMatrixAt(0, fearfulEye);
  normalScale.setFromMatrixScale(normalEye);
  fearScale.setFromMatrixScale(fearfulEye);
  expect(fearScale.x).toBeGreaterThan(normalScale.x);

  state.civilians[0].mood = "sad";
  view.update(state, undefined, 1, camera);
  eyes.getMatrixAt(0, bowedEye);
  hair.getMatrixAt(0, bowedHair);
  expect(bowedEye.elements[13]).toBeLessThan(normalEye.elements[13]);
  expect(bowedHair.elements[13]).toBeLessThan(normalHair.elements[13]);
  expect(bowedHair.elements[14]).toBeGreaterThan(normalHair.elements[14]);
  view.reset();
  expect(eyes.count).toBe(0);
});
it("adds deterministic shared headwear variants without per-person meshes", () => {
  const view = new CivilianView(8),
    state = snapshot(1, true) as any;
  state.civilians = Array.from({ length: 8 }, (_, id) => ({
    ...state.civilians[0],
    id,
    p: [id * 3, 10, 0],
  }));
  view.update(state, undefined, 1, camera);
  const wideHat = view.group.children[9] as THREE.InstancedMesh,
    cap = view.group.children[10] as THREE.InstancedMesh,
    scarves = view.group.children[11] as THREE.InstancedMesh,
    hair = view.group.children[12] as THREE.InstancedMesh,
    distant = view.group.children[13] as THREE.InstancedMesh,
    matrix = new THREE.Matrix4(),
    colorA = new THREE.Color(),
    colorB = new THREE.Color();
  expect(wideHat.count).toBe(2);
  expect(cap.count).toBe(2);
  expect(scarves.count).toBe(3);
  expect(hair.count).toBe(4);
  expect(distant.count).toBe(0);
  wideHat.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeGreaterThan(12);
  wideHat.getColorAt(0, colorA);
  wideHat.getColorAt(1, colorB);
  expect(colorA.equals(colorB)).toBe(false);
  expect(view.group.children).toHaveLength(17);
});
it("adds deterministic shared scarves to a subset of near residents", () => {
  const view = new CivilianView(8),
    state = snapshot(1, true) as any;
  state.civilians = Array.from({ length: 8 }, (_, id) => ({
    ...state.civilians[0],
    id,
    p: [id * 3, 10, 0],
  }));
  view.update(state, undefined, 1, camera);
  const scarves = view.group.children[11] as THREE.InstancedMesh,
    matrix = new THREE.Matrix4(),
    colorA = new THREE.Color(),
    colorB = new THREE.Color();
  expect(scarves.count).toBe(3);
  scarves.geometry.computeBoundingBox();
  expect(scarves.geometry.boundingBox!.max.x).toBeLessThan(0.38);
  scarves.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeGreaterThan(11.7);
  scarves.getColorAt(0, colorA);
  scarves.getColorAt(1, colorB);
  expect(colorA.equals(colorB)).toBe(false);
  view.reset();
  expect(scarves.count).toBe(0);
});
it("adds shared natural hair silhouettes to residents without headwear", () => {
  const view = new CivilianView(8),
    state = snapshot(1, true) as any;
  state.civilians = Array.from({ length: 8 }, (_, id) => ({
    ...state.civilians[0],
    id,
    p: [id * 3, 10, 0],
  }));
  view.update(state, undefined, 1, camera);
  const hair = view.group.children[12] as THREE.InstancedMesh,
    matrix = new THREE.Matrix4(),
    first = new THREE.Color(),
    second = new THREE.Color();
  expect(hair.count).toBe(4);
  hair.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeGreaterThan(12);
  hair.getColorAt(0, first);
  hair.getColorAt(1, second);
  expect(first.equals(second)).toBe(false);
  view.reset();
  expect(hair.count).toBe(0);
});
it("uses human-scale proportions while keeping resident feet at ground level", () => {
  const view = new CivilianView(1);
  view.update(snapshot(1, true), undefined, 1, camera);
  const torsoMatrix = new THREE.Matrix4(),
    bootMatrix = new THREE.Matrix4();
  (view.group.children[0] as THREE.InstancedMesh).getMatrixAt(0, torsoMatrix);
  (view.group.children[8] as THREE.InstancedMesh).getMatrixAt(0, bootMatrix);
  expect(torsoMatrix.elements[13]).toBeCloseTo(11.275, 3);
  expect(bootMatrix.elements[13]).toBeCloseTo(10.09, 3);
  expect(torsoMatrix.elements[0]).toBeCloseTo(0.825, 3);
});
