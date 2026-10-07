import { voiceReplacement, type AudibleVoice } from "./audio-priority";
import { loadRecordings, type Recording } from "./audio-recordings";
import type {
  Vec3,
  Explosion,
  WeaponId,
  ContactSound,
  LaserStrike,
} from "./types";
import { setAudioPosition, setListenerOrientation } from "./spatial-audio";
import {
  createBlastLimiter,
  createBlastNoise,
  playNukeBlast,
} from "./blast-audio";
export class GameAudio {
  private laserVoices = new Map<
    number,
    { update: (l: LaserStrike) => void; stop: () => void }
  >();
  private recordings = new Map<Recording, AudioBuffer>();
  private loops = new Map<
    Recording,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();
  private listenerPosition: Vec3 = [0, 0, 0];
  private ctx?: AudioContext;
  private master?: GainNode;
  private mix?: DynamicsCompressorNode;
  private blastNoise?: AudioBuffer;
  private nukeVoices: ReturnType<typeof playNukeBlast>[] = [];
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private filter?: BiquadFilterNode;
  private voices: (AudibleVoice & { stop: () => void })[] = [];
  private turbine?: OscillatorNode;
  private turbineGain?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private volume = 0.35;
  private muted = false;
  private lastDiscoStep = -1;
  private lastNuke = -Infinity;
  private lastNukePosition: Vec3 = [0, 0, 0];
  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.mix = createBlastLimiter(this.ctx, this.master);
      this.blastNoise = createBlastNoise(this.ctx);
      this.engine = this.ctx.createOscillator();
      this.engine.type = "sawtooth";
      this.engine.frequency.value = 65;
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 220;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.035;
      this.engine.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.mix);
      this.engine.start();
      this.turbine = this.ctx.createOscillator();
      this.turbine.type = "sine";
      this.turbineGain = this.ctx.createGain();
      this.turbineGain.gain.value = 0.008;
      this.turbine.connect(this.turbineGain).connect(this.mix);
      this.turbine.start();
      const wind = this.ctx.createBufferSource();
      wind.buffer = this.blastNoise;
      wind.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.frequency.value = 650;
      this.windFilter.Q.value = 0.45;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.02;
      wind.connect(this.windFilter).connect(this.windGain).connect(this.mix);
      wind.start();
      void loadRecordings(this.ctx).then((buffers) => {
        this.recordings = buffers;
        for (const name of ["turbine", "wind", "forest", "river"] as const) {
          const buffer = buffers.get(name);
          if (!buffer || !this.ctx || !this.mix) continue;
          const source = this.ctx.createBufferSource(),
            gain = this.ctx.createGain();
          source.buffer = buffer;
          source.loop = true;
          gain.gain.value = 0;
          source.connect(gain).connect(this.mix);
          source.start();
          this.loops.set(name, { source, gain });
          // Recordings can finish decoding during combat. Reserve their voices
          // immediately instead of exceeding the ordinary pool until another hit.
          while (this.voices.length + this.loops.size > 24) {
            const quietest = voiceReplacement(
              this.voices,
              { p: this.listenerPosition, gain: Infinity, priority: 1 },
              this.listenerPosition,
              this.voices.length,
            );
            this.voices[quietest].stop();
          }
        }
      });
    }
    await this.ctx.resume();
  }
  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  setMute(v: boolean) {
    this.muted = v;
    this.setVolume(this.volume);
  }
  pause() {
    this.ctx?.suspend().catch(() => {});
  }
  update(
    speed: number,
    p: Vec3,
    forward: Vec3,
    boost = false,
    ambience = { altitude: 200, forest: 0, water: 0 },
  ) {
    if (!this.ctx || !this.engine) return;
    this.engine.frequency.setTargetAtTime(
      45 + speed * 0.6,
      this.ctx.currentTime,
      0.2,
    );
    this.filter!.frequency.setTargetAtTime(
      180 + speed * 2,
      this.ctx.currentTime,
      0.2,
    );
    const throttle = Math.max(0, Math.min(1, (speed - 35) / 85));
    this.engineGain!.gain.setTargetAtTime(
      0.02 + throttle * 0.025,
      this.ctx.currentTime,
      0.25,
    );
    this.turbine!.frequency.setTargetAtTime(
      220 + throttle * 520 + (boost ? 130 : 0),
      this.ctx.currentTime,
      0.3,
    );
    this.turbineGain!.gain.setTargetAtTime(
      0.005 + throttle * 0.008,
      this.ctx.currentTime,
      0.3,
    );
    this.windGain!.gain.setTargetAtTime(
      0.012 + throttle * 0.07,
      this.ctx.currentTime,
      0.3,
    );
    this.windFilter!.frequency.setTargetAtTime(
      400 + throttle * 1100,
      this.ctx.currentTime,
      0.3,
    );
    this.listenerPosition = p;
    const near = Math.max(0, 1 - ambience.altitude / 180);
    for (const [name, loop] of this.loops) {
      const gain =
        name === "turbine"
          ? 0.025 + throttle * 0.075
          : name === "wind"
            ? 0.015 + throttle * 0.035
            : name === "forest"
              ? ambience.forest * near * 0.07
              : ambience.water * near * 0.09;
      loop.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.8);
      if (name === "turbine")
        loop.source.playbackRate.setTargetAtTime(
          0.85 + throttle * 0.3,
          this.ctx.currentTime,
          0.4,
        );
    }
    const l = this.ctx.listener;
    setAudioPosition(l, p);
    setListenerOrientation(l, forward);
  }
  private admit(p: Vec3, gain: number, priority: number) {
    const index = voiceReplacement(
      this.voices,
      { p, gain, priority },
      this.listenerPosition,
      24 - this.loops.size,
    );
    if (index < 0) return false;
    if (index < this.voices.length) this.voices[index].stop();
    return true;
  }
  private noise(
    p: Vec3,
    duration: number,
    gain: number,
    cutoff: number,
    priority = 1,
  ) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    if (!this.admit(p, gain, priority)) return;
    const source = c.createBufferSource();
    source.buffer = this.blastNoise!;
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const volume = c.createGain();
    volume.gain.setValueAtTime(gain, c.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    const pan = c.createPanner();
    pan.distanceModel = "inverse";
    pan.refDistance = 100;
    pan.maxDistance = 2000;
    pan.rolloffFactor = 0.9;
    setAudioPosition(pan, p);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(pan);
    pan.connect(this.mix!);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      source.disconnect();
      filter.disconnect();
      volume.disconnect();
      pan.disconnect();
      this.voices = this.voices.filter((v) => v.stop !== stop);
    };
    const stop = () => {
      source.stop();
      finish();
    };
    this.voices.push({ stop, p: [...p], gain, priority });
    source.onended = finish;
    source.start();
    source.stop(c.currentTime + duration);
  }
  private recording(
    name: Recording,
    p: Vec3,
    gain: number,
    duration = 2,
    rate = 1,
    cutoff = 6800,
  ) {
    const buffer = this.recordings.get(name);
    if (!buffer || !this.ctx || !this.mix) return false;
    const priority = name === "explosion" ? 3 : name === "cheer" ? 0.7 : 1;
    // A suppressed recording is handled; do not recreate it as a synth voice.
    if (!this.admit(p, gain, priority)) return true;
    const c = this.ctx,
      source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      volume = c.createGain(),
      pan = c.createPanner();
    const distance = Math.hypot(
      p[0] - this.listenerPosition[0],
      p[1] - this.listenerPosition[1],
      p[2] - this.listenerPosition[2],
    );
    source.buffer = buffer;
    source.playbackRate.value = rate;
    filter.type = "lowpass";
    filter.frequency.value = 800 + (cutoff - 800) * Math.exp(-distance / 450);
    volume.gain.value = gain;
    volume.gain.setTargetAtTime(
      0.0001,
      c.currentTime + duration * 0.6,
      duration * 0.15,
    );
    pan.distanceModel = "inverse";
    pan.refDistance = 80;
    pan.maxDistance = 2500;
    pan.rolloffFactor = 1.1;
    setAudioPosition(pan, p);
    source.connect(filter).connect(volume).connect(pan).connect(this.mix);
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      source.disconnect();
      filter.disconnect();
      volume.disconnect();
      pan.disconnect();
      this.voices = this.voices.filter((v) => v.stop !== stop);
    };
    const stop = () => {
      try {
        source.stop();
      } catch {}
      finish();
    };
    this.voices.push({ stop, p: [...p], gain, priority });
    source.onended = finish;
    source.start();
    source.stop(c.currentTime + Math.min(duration, buffer.duration / rate));
    return true;
  }
  contact(e: ContactSound) {
    const settle = e.action === "settle";
    const energy = Math.min(2, Math.max(0, e.energy));
    // Loose soil, leaves and glazing have no masonry-sized thump.
    if (
      e.material === "earth" ||
      e.material === "foliage" ||
      e.material === "window"
    ) {
      const glass = e.material === "window",
        leaves = e.material === "foliage";
      this.noise(
        e.p,
        settle ? 0.16 : glass ? 0.42 : leaves ? 0.5 : 0.3,
        (settle ? 0.018 : glass ? 0.045 : 0.035) * energy,
        glass ? 7200 : leaves ? 2400 : 650,
        settle ? 0.45 : 1,
      );
      return;
    }
    const timber = e.material === "wood";
    const tile = e.material === "roof" || e.material === "slate";
    const plaster = e.material === "plaster";
    const duration = settle
      ? 0.2
      : timber
        ? 0.65
        : tile
          ? 0.32
          : plaster
            ? 0.38
            : 0.8;
    const gain =
      (settle ? 0.04 : tile ? 0.085 : plaster ? 0.095 : 0.13) * energy;
    const rate = (tile ? 1.35 : plaster ? 1.15 : 0.9) + (e.energy % 1) * 0.2;
    const cutoff = timber ? 3300 : tile ? 6800 : plaster ? 2800 : 5200;
    if (
      this.recording(
        timber ? "wood" : "stone",
        e.p,
        gain,
        duration,
        rate,
        cutoff,
      )
    )
      return;
    this.noise(e.p, duration, gain * 0.65, cutoff, settle ? 0.45 : 1);
  }
  monster(p: Vec3, kind: "hit" | "defeat" | "throw" | "swipe") {
    this.noise(
      p,
      kind === "defeat" ? 1.8 : kind === "throw" ? 0.6 : 0.35,
      kind === "defeat" ? 0.42 : kind === "swipe" ? 0.24 : 0.13,
      kind === "defeat" ? 300 : kind === "throw" ? 520 : 900,
    );
  }
  settlement(p: Vec3, kind: "cheer" | "sad") {
    if (kind === "cheer" && this.recording("cheer", p, 0.2, 2.5)) return;
    if (!this.ctx || this.ctx.state !== "running") return;
    const c = this.ctx;
    if (!this.admit(p, 0.06, 0.7)) return;
    const pan = c.createPanner();
    pan.distanceModel = "inverse";
    pan.refDistance = 90;
    pan.maxDistance = 1800;
    pan.rolloffFactor = 1.1;
    setAudioPosition(pan, p);
    pan.connect(this.mix!);
    const gain = c.createGain();
    gain.connect(pan);
    const duration = kind === "cheer" ? 1.5 : 1.8;
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(0.06, c.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    const nodes: OscillatorNode[] = [];
    for (let i = 0; i < 3; i++) {
      const voice = c.createOscillator();
      voice.type = "triangle";
      const start = (kind === "cheer" ? 280 : 240) * (1 + i * 0.23);
      voice.frequency.setValueAtTime(start, c.currentTime);
      voice.frequency.linearRampToValueAtTime(
        start * (kind === "cheer" ? 1.55 : 0.65),
        c.currentTime + duration * 0.65,
      );
      voice.connect(gain);
      voice.start();
      voice.stop(c.currentTime + duration);
      nodes.push(voice);
    }
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      for (const v of nodes) v.disconnect();
      gain.disconnect();
      pan.disconnect();
      this.voices = this.voices.filter((v) => v.stop !== stop);
    };
    const stop = () => {
      for (const v of nodes)
        try {
          v.stop();
        } catch {}
      finish();
    };
    nodes[0].onended = finish;
    this.voices.push({ stop, p: [...p], gain: 0.06, priority: 0.7 });
  }
  reset() {
    this.lastNuke = -Infinity;
    this.lastDiscoStep = -1;
    for (const voice of this.laserVoices.values()) voice.stop();
    this.laserVoices.clear();
    for (const voice of [...this.voices]) voice.stop();
    for (const voice of this.nukeVoices.splice(0)) voice.stop();
  }
  get stats() {
    return {
      ordinaryVoices: this.voices.length + this.loops.size,
      recordingsLoaded: this.recordings.size,
      nukeVoices: this.nukeVoices.length,
      laserVoices: this.laserVoices.size,
    };
  }

  explosion(e: Explosion) {
    if (e.kind !== "nuke" && e.water) {
      // A river ambience excerpt sounds like a loop fragment when fired as an
      // impact. Use a compact low splash body plus a lighter spray layer; both
      // pass through the ordinary bounded, spatialized voice pool.
      const strength = Math.min(1.5, Math.max(0.35, e.power));
      this.noise(
        e.p,
        e.kind === "collapse" ? 1.25 : 0.62,
        (e.kind === "collapse" ? 0.34 : 0.22) * strength,
        e.kind === "collapse" ? 760 : 1050,
        1,
      );
      this.noise(
        [e.p[0], e.p[1] + 1.2, e.p[2]],
        0.28,
        0.055 * strength,
        4200,
        0.7,
      );
      return;
    }
    if (
      e.kind !== "nuke" &&
      this.recording("explosion", e.p, 0.18, 1)
    )
      return;
    if (e.kind === "nuke") {
      if (!this.ctx || !this.mix || !this.blastNoise) return;
      const p = this.lastNukePosition;
      if (
        this.ctx.currentTime - this.lastNuke < 0.18 &&
        (e.p[0] - p[0]) ** 2 + (e.p[1] - p[1]) ** 2 + (e.p[2] - p[2]) ** 2 <
          150 ** 2
      )
        return;
      this.lastNuke = this.ctx.currentTime;
      p[0] = e.p[0];
      p[1] = e.p[1];
      p[2] = e.p[2];
      // Bounded overlap during rapid drops; older voices fade out instead of stacking forever.
      if (this.nukeVoices.length >= 4) this.nukeVoices.shift()!.stop();
      const voice = playNukeBlast(
        this.ctx,
        this.mix,
        this.blastNoise,
        e,
        () => {
          this.nukeVoices = this.nukeVoices.filter((v) => v !== voice);
        },
      );
      this.nukeVoices.push(voice);
      return;
    }
    this.noise(
      e.p,
      e.kind === "collapse" ? 2.5 : 1.7,
      e.kind === "collapse" ? 0.55 : 1,
      e.water ? 180 : 750,
    );
  }

  launch(p: Vec3, weapon: WeaponId = "cannon") {
    if (weapon === "laser") return;
    this.noise(
      p,
      weapon === "nuke" ? 0.45 : 0.22,
      weapon === "nuke" ? 0.3 : 0.2,
      weapon === "nuke" ? 420 : 1700,
      3,
    );
  }
  syncDisco(enabled: boolean, simTime: number) {
    if (!enabled || !this.ctx || !this.mix) {
      this.lastDiscoStep = -1;
      return;
    }
    const step = Math.floor(simTime * 4);
    if (step === this.lastDiscoStep) return;
    this.lastDiscoStep = step;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const hat = ctx.createBufferSource();
    hat.buffer = this.blastNoise!;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4500;
    const hatGain = ctx.createGain();
    hatGain.gain.setValueAtTime(step % 2 ? 0.018 : 0.035, now);
    hatGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    hat.connect(filter).connect(hatGain).connect(this.mix);
    hat.start(now);
    hat.stop(now + 0.1);
    hat.onended = () => {
      hat.disconnect();
      filter.disconnect();
      hatGain.disconnect();
    };
    if (step % 2 === 0) {
      const kick = ctx.createOscillator();
      kick.type = "sine";
      kick.frequency.setValueAtTime(135, now);
      kick.frequency.exponentialRampToValueAtTime(48, now + 0.18);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
      kick.connect(gain).connect(this.mix);
      kick.start(now);
      kick.stop(now + 0.24);
      kick.onended = () => {
        kick.disconnect();
        gain.disconnect();
      };
    }
  }
  syncLasers(lasers: LaserStrike[], listener: Vec3) {
    if (!this.ctx || !this.mix || !this.blastNoise) return;
    const c = this.ctx;
    const selected = lasers
      .filter((l) => l.phase !== "finishing")
      .sort(
        (a, b) =>
          Math.hypot(a.p[0] - listener[0], a.p[2] - listener[2]) -
          Math.hypot(b.p[0] - listener[0], b.p[2] - listener[2]),
      )
      .slice(0, 4);
    const ids = new Set(selected.map((l) => l.id));
    for (const [id, voice] of this.laserVoices)
      if (!ids.has(id)) {
        voice.stop();
        this.laserVoices.delete(id);
      }
    for (const l of selected) {
      if (!this.laserVoices.has(l.id)) {
        const tone = c.createOscillator(),
          bass = c.createOscillator(),
          noise = c.createBufferSource();
        tone.type = "sawtooth";
        bass.type = "sine";
        noise.buffer = this.blastNoise;
        noise.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = "lowpass";
        const tonalGain = c.createGain(),
          bassGain = c.createGain(),
          roarGain = c.createGain(),
          pan = c.createPanner();
        tonalGain.gain.value = bassGain.gain.value = roarGain.gain.value = 0;
        pan.refDistance = 180;
        pan.rolloffFactor = 0.7;
        setAudioPosition(pan, l.p);
        tone.connect(tonalGain).connect(pan);
        bass.connect(bassGain).connect(pan);
        noise.connect(filter).connect(roarGain).connect(pan);
        pan.connect(this.mix);
        tone.start();
        bass.start();
        noise.start();
        let prior = l.phase,
          stopped = false;
        this.laserVoices.set(l.id, {
          update: (strike) => {
            const charge = strike.phase === "charging",
              progress = Math.min(1, strike.age / 4);
            if (prior === "charging" && !charge)
              this.noise(strike.p, 1.5, 0.8, 3000, 3);
            prior = strike.phase;
            tone.frequency.setTargetAtTime(
              charge
                ? 110 + progress * progress * 1250
                : 95 + Math.sin(strike.age * 22) * 12,
              c.currentTime,
              0.035,
            );
            bass.frequency.setTargetAtTime(
              charge ? 40 + progress * 50 : 42,
              c.currentTime,
              0.05,
            );
            filter.frequency.setTargetAtTime(
              charge ? 300 + progress * 2000 : 1500,
              c.currentTime,
              0.05,
            );
            tonalGain.gain.setTargetAtTime(
              charge ? 0.012 + progress * 0.065 : 0.035,
              c.currentTime,
              0.035,
            );
            bassGain.gain.setTargetAtTime(
              charge ? progress * 0.07 : 0.2,
              c.currentTime,
              0.05,
            );
            roarGain.gain.setTargetAtTime(
              charge ? progress * progress * 0.04 : 0.15,
              c.currentTime,
              0.04,
            );
          },
          stop: () => {
            if (stopped) return;
            stopped = true;
            tonalGain.gain.setTargetAtTime(0, c.currentTime, 0.03);
            bassGain.gain.setTargetAtTime(0, c.currentTime, 0.03);
            roarGain.gain.setTargetAtTime(0, c.currentTime, 0.03);
            for (const source of [tone, bass, noise])
              source.stop(c.currentTime + 0.15);
            noise.onended = () => {
              for (const node of [
                tone,
                bass,
                noise,
                filter,
                tonalGain,
                bassGain,
                roarGain,
                pan,
              ])
                node.disconnect();
            };
          },
        });
      }
      this.laserVoices.get(l.id)!.update(l);
    }
  }
}
