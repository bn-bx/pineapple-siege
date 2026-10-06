import type { Vec3 } from "./types";
export interface AudibleVoice {
  priority: number;
  gain: number;
  p: Vec3;
}
/** Recompute audibility as the listener moves; a distant chip cannot steal a warning. */
export function voiceScore(voice: AudibleVoice, listener: Vec3) {
  const distance = Math.hypot(
    voice.p[0] - listener[0],
    voice.p[1] - listener[1],
    voice.p[2] - listener[2],
  );
  return (voice.gain * voice.priority) / (1 + distance / 80);
}
export function voiceReplacement(
  voices: AudibleVoice[],
  candidate: AudibleVoice,
  listener: Vec3,
  limit: number,
) {
  if (voices.length < limit) return voices.length;
  if (limit <= 0 || !voices.length) return -1;
  let index = 0,
    score = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const value = voiceScore(voices[i], listener);
    if (value < score) {
      score = value;
      index = i;
    }
  }
  return voiceScore(candidate, listener) >= score ? index : -1;
}
