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
  private ctx?: AudioContext;
  private master?: GainNode;
  private mix?: DynamicsCompressorNode;
  private blastNoise?: AudioBuffer;
  private nukeVoices: ReturnType<typeof playNukeBlast>[] = [];
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private filter?: BiquadFilterNode;
  private voices: (() => void)[] = [];
  private turbine?: OscillatorNode;
  private turbineGain?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private volume = 0.35;
  private muted = false;
  private lastDiscoStep = -1;
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
  update(speed: number, p: Vec3, forward: Vec3, boost = false) {
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
    const l = this.ctx.listener;
    setAudioPosition(l, p);
    setListenerOrientation(l, forward);
  }
  private noise(p: Vec3, duration: number, gain: number, cutoff: number) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    if (this.voices.length >= 24) this.voices[0]();
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
      this.voices = this.voices.filter((v) => v !== stop);
    };
    const stop = () => {
      source.stop();
      finish();
    };
    this.voices.push(stop);
    source.onended = finish;
    source.start();
    source.stop(c.currentTime + duration);
  }
  contact(e: ContactSound) {
    const timber = e.material === "wood" || e.material === "foliage";
    const settle = e.action === "settle";
    this.noise(
      e.p,
      settle ? 0.35 : timber ? 0.65 : 0.28,
      (settle ? 0.035 : 0.08) * Math.min(2, e.energy),
      timber ? (settle ? 380 : 1250) : settle ? 1100 : 2600,
    );
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
    if (!this.ctx || this.ctx.state !== "running") return;
    const c = this.ctx;
    if (this.voices.length >= 24) this.voices[0]();
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
      this.voices = this.voices.filter((v) => v !== stop);
    };
    const stop = () => {
      for (const v of nodes)
        try {
          v.stop();
        } catch {}
      finish();
    };
    nodes[0].onended = finish;
    this.voices.push(stop);
  }
  reset() {
    this.lastDiscoStep = -1;
    for (const voice of this.laserVoices.values()) voice.stop();
    this.laserVoices.clear();
    for (const stop of [...this.voices]) stop();
    for (const voice of this.nukeVoices.splice(0)) voice.stop();
  }
  get stats() {
    return {
      ordinaryVoices: this.voices.length,
      nukeVoices: this.nukeVoices.length,
      laserVoices: this.laserVoices.size,
    };
  }

  explosion(e: Explosion) {
    if (e.kind === "nuke") {
      if (!this.ctx || !this.mix || !this.blastNoise) return;
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
              this.noise(strike.p, 1.5, 0.8, 3000);
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
