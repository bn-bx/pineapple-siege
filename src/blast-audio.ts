import type { Explosion } from "./types";
import { setAudioPosition } from "./spatial-audio";

export function createBlastLimiter(
  ctx: BaseAudioContext,
  destination: AudioNode,
) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 10;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.4;
  // Catch the very first transient before the compressor's attack can react.
  const ceiling = ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1,
      a = Math.abs(x);
    curve[i] =
      Math.sign(x) *
      (a <= 0.65 ? a : 0.65 + 0.3 * (1 - Math.exp(-(a - 0.65) / 0.3)));
  }
  ceiling.curve = curve;
  ceiling.oversample = "2x";
  limiter.connect(ceiling);
  ceiling.connect(destination);
  return limiter;
}

/** Shared noise bed: generated once, reused by all blast layers. */
export function createBlastNoise(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 71839;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    data[i] = (seed >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

/** One bounded, spatial voice with an impact crack, bass drop, roar and rolling tail. */
export function playNukeBlast(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  event: Explosion,
  onEnded: () => void = () => {},
) {
  const now = ctx.currentTime;
  const strength = Math.max(
    0,
    Math.min(1, ((event.profile?.cloudHeight ?? 120) - 120) / 480),
  );
  const duration = 10 + strength * 4;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const bus = ctx.createGain(),
    pan = ctx.createPanner();
  nodes.push(bus, pan);
  bus.gain.value = 1;
  pan.panningModel = "equalpower";
  pan.distanceModel = "inverse";
  pan.refDistance = 220 + strength * 100;
  pan.maxDistance = 3000;
  pan.rolloffFactor = 0.65;
  setAudioPosition(pan, event.p);
  bus.connect(pan);
  pan.connect(destination);
  let remaining = 0,
    finished = false;
  function register(
    source: AudioScheduledSourceNode,
    start: number,
    end: number,
  ) {
    sources.push(source);
    nodes.push(source);
    remaining++;
    source.onended = () => {
      if (--remaining === 0 && !finished) {
        finished = true;
        for (const node of nodes) node.disconnect();
        onEnded();
      }
    };
    source.start(now + start);
    source.stop(now + end);
  }
  function noiseLayer(
    delay: number,
    length: number,
    level: number,
    from: number,
    to: number,
    attack: number,
  ) {
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = noise;
    source.loop = true;
    source.playbackRate.value = 0.65 + delay * 0.07;
    filter.type = "lowpass";
    filter.Q.value = 0.65;
    filter.frequency.setValueAtTime(
      event.water ? from * 0.45 : from,
      now + delay,
    );
    filter.frequency.exponentialRampToValueAtTime(to, now + delay + length);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(level, now + delay + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    nodes.push(filter, gain);
    register(source, delay, delay + length + 0.05);
  }
  noiseLayer(0, 0.7, 0.9, 4200, 450, 0.008); // Initial pressure crack.
  noiseLayer(0.06, 4.5, 1.4, 1500, 90, 0.12); // Expanding, falling roar.
  noiseLayer(0.35, duration - 0.4, 1.2, 240, 45, 0.5); // Long low rumble.
  noiseLayer(0.9, 3.5, 0.55, 650, 75, 0.2); // First rolling reflection.
  noiseLayer(2.1, 4.5, 0.38, 380, 50, 0.3); // Distant valley echo.
  for (const [hz, level, length] of [
    [105, 0.42, 2.8],
    [52, 0.32, 5.5],
  ]) {
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(hz, now);
    oscillator.frequency.exponentialRampToValueAtTime(25, now + length);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    oscillator.connect(gain);
    gain.connect(bus);
    nodes.push(gain);
    register(oscillator, 0, length + 0.05);
  }
  return {
    duration,
    stop() {
      if (finished) return;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.025);
      for (const source of sources) {
        try {
          source.stop(ctx.currentTime + 0.12);
        } catch {
          /* Already ended. */
        }
      }
    },
  };
}
