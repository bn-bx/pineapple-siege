export const AUDIO_RECORDINGS = {
  turbine: "/assets/audio/turbine.wav",
  wind: "/assets/audio/wind.wav",
  forest: "/assets/audio/forest.wav",
  river: "/assets/audio/river.wav",
  explosion: "/assets/audio/explosion.wav",
  wood: "/assets/audio/wood.ogg",
  stone: "/assets/audio/stone.ogg",
  cheer: "/assets/audio/cheer.ogg",
} as const;
export type Recording = keyof typeof AUDIO_RECORDINGS;
/** Decode outside the simulation; unavailable recordings retain audible fallbacks. */
export async function loadRecordings(context: AudioContext) {
  const buffers = new Map<Recording, AudioBuffer>();
  const names = Object.keys(AUDIO_RECORDINGS) as Recording[];
  for (let i = 0; i < names.length; i += 2)
    await Promise.all(
      names.slice(i, i + 2).map(async (name) => {
        try {
          const response = await fetch(AUDIO_RECORDINGS[name]);
          if (!response.ok) throw Error("Audio unavailable");
          buffers.set(
            name,
            await context.decodeAudioData(await response.arrayBuffer()),
          );
        } catch {
          /* The existing synth mix remains playable on codec/network failure. */
        }
      }),
    );
  return buffers;
}
