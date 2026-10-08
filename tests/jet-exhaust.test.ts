import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeJet } from "../src/render/assets";
import { CONFIG } from "../src/config";
import { jetExhaustProfile } from "../src/render/jet-exhaust";

describe("jet exhaust", () => {
  it("stays subtle at cruise and brightens smoothly with speed", () => {
    const cruise = jetExhaustProfile(62, 0);
    const fast = jetExhaustProfile(105, 0);
    expect(cruise.outerOpacity).toBeGreaterThan(0.42);
    expect(fast.outerOpacity).toBeGreaterThan(cruise.outerOpacity);
    expect(fast.coreOpacity).toBeGreaterThan(cruise.coreOpacity);
    expect(fast.outerLength).toBeGreaterThan(cruise.outerLength);
  });

  it("keeps the hot core shorter and all emission bounded", () => {
    const profile = jetExhaustProfile(CONFIG.boostSpeed, Math.PI / 2);
    expect(profile.coreLength).toBeLessThan(profile.outerLength);
    expect(profile.outerOpacity).toBeLessThanOrEqual(0.821);
    expect(profile.coreOpacity).toBeLessThanOrEqual(0.931);
    expect(jetExhaustProfile(1_000, 0).outerLength).toBeLessThan(1.8);
  });

  it("keeps normal full throttle visually distinct from boost", () => {
    const normal = jetExhaustProfile(CONFIG.maxSpeed, 0);
    const boost = jetExhaustProfile(CONFIG.boostSpeed, 0);
    expect(boost.outerLength).toBeGreaterThan(normal.outerLength);
    expect(boost.coreOpacity).toBeGreaterThan(normal.coreOpacity);
  });

  it("uses a small repeatable pulse instead of a hard speed threshold", () => {
    const first = jetExhaustProfile(90, 0.2);
    const second = jetExhaustProfile(90, 0.2);
    const nextFrame = jetExhaustProfile(90, 0.3);
    expect(first).toEqual(second);
    expect(nextFrame.outerLength).not.toBe(first.outerLength);
    expect(Math.abs(nextFrame.outerLength - first.outerLength)).toBeLessThan(
      0.01,
    );
  });

  it("builds paired translucent outer plumes and hot cores", () => {
    const jet = makeJet();
    const outer = jet.children.filter((child) => child.name === "flame");
    const cores = jet.children.filter((child) => child.name === "flame-core");
    expect(outer).toHaveLength(2);
    expect(cores).toHaveLength(2);
    for (const child of [...outer, ...cores]) {
      const material = (child as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
    }
    jet.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
  });

  it("builds a half-dome canopy, readable panel seams, and named moving ailerons", () => {
    const jet = makeJet(),
      canopy = jet.getObjectByName("canopy-glass") as THREE.Mesh,
      seams = jet.getObjectByName("wing-panel-seams") as THREE.LineSegments,
      left = jet.getObjectByName("aileron-left") as THREE.Mesh,
      right = jet.getObjectByName("aileron-right") as THREE.Mesh;
    expect(canopy.geometry.parameters.thetaLength).toBeCloseTo(Math.PI / 2);
    expect(jet.getObjectByName("canopy-frame")).toBeDefined();
    expect(seams.geometry.getAttribute("position").count).toBeGreaterThan(8);
    expect(left).toBeInstanceOf(THREE.Mesh);
    expect(right).toBeInstanceOf(THREE.Mesh);
    expect(left.position.x).toBeLessThan(0);
    expect(right.position.x).toBeGreaterThan(0);
    jet.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        const { material } = object;
        if (Array.isArray(material))
          material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    });
  });

  it("keeps a shared, readable cockpit set under either aircraft asset", () => {
    const jet = makeJet(),
      cockpit = jet.getObjectByName("cockpit-details"),
      display = cockpit?.getObjectByName("multifunction-display") as
        | THREE.Mesh
        | undefined,
      hud = cockpit?.getObjectByName("hud-combiner") as THREE.Mesh | undefined,
      bezels = cockpit?.getObjectByName("flight-instrument-bezels") as
        | THREE.Mesh
        | undefined;
    expect(cockpit).toBeInstanceOf(THREE.Group);
    expect(cockpit?.getObjectByName("pilot-torso")).toBeDefined();
    expect(cockpit?.getObjectByName("pilot-harness")).toBeDefined();
    expect(cockpit?.getObjectByName("side-consoles")).toBeDefined();
    expect(display?.material).toMatchObject({ transparent: true });
    expect(hud?.material).toMatchObject({
      transparent: true,
      depthWrite: false,
    });
    expect(display?.position.y).toBeGreaterThan(0.8);
    expect(hud?.position.y).toBeGreaterThan(display?.position.y ?? 0);
    expect(bezels?.geometry.getAttribute("position").count).toBeGreaterThan(80);
    jet.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
  });
});
