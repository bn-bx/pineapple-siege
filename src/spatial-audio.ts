import type { Vec3 } from "./types";

/** Firefox still exposes listener pose through the legacy Web Audio methods. */
export function setAudioPosition(target: AudioListener | PannerNode, p: Vec3) {
  if (target.positionX && target.positionY && target.positionZ) {
    target.positionX.value = p[0];
    target.positionY.value = p[1];
    target.positionZ.value = p[2];
  } else target.setPosition(...p);
}

export function setListenerOrientation(listener: AudioListener, forward: Vec3) {
  if (
    listener.forwardX &&
    listener.forwardY &&
    listener.forwardZ &&
    listener.upX &&
    listener.upY &&
    listener.upZ
  ) {
    listener.forwardX.value = forward[0];
    listener.forwardY.value = forward[1];
    listener.forwardZ.value = forward[2];
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  } else listener.setOrientation(...forward, 0, 1, 0);
}
