"use strict";
(() => {
  // src/blast-audio.ts
  function createBlastLimiter(ctx, destination) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 10;
    limiter.ratio.value = 10;
    limiter.attack.value = 3e-3;
    limiter.release.value = 0.4;
    const ceiling = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = i / (curve.length - 1) * 2 - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= 0.65 ? a : 0.65 + 0.3 * (1 - Math.exp(-(a - 0.65) / 0.3)));
    }
    ceiling.curve = curve;
    ceiling.oversample = "2x";
    limiter.connect(ceiling);
    ceiling.connect(destination);
    return limiter;
  }
  function createBlastNoise(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 71839;
    for (let i = 0; i < data.length; i++) {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      data[i] = (seed >>> 0) / 2147483648 - 1;
    }
    return buffer;
  }
  function playNukeBlast(ctx, destination, noise, event, onEnded = () => {
  }) {
    const now = ctx.currentTime;
    const strength = Math.max(
      0,
      Math.min(1, ((event.profile?.cloudHeight ?? 120) - 120) / 480)
    );
    const duration = 10 + strength * 4;
    const nodes = [];
    const sources = [];
    const bus = ctx.createGain(), pan = ctx.createPanner();
    nodes.push(bus, pan);
    bus.gain.value = 1;
    pan.panningModel = "equalpower";
    pan.distanceModel = "inverse";
    pan.refDistance = 220 + strength * 100;
    pan.maxDistance = 3e3;
    pan.rolloffFactor = 0.65;
    pan.positionX.value = event.p[0];
    pan.positionY.value = event.p[1];
    pan.positionZ.value = event.p[2];
    bus.connect(pan);
    pan.connect(destination);
    let remaining = 0, finished = false;
    function register(source, start, end) {
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
    function noiseLayer(delay, length, level, from, to, attack) {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = noise;
      source.loop = true;
      source.playbackRate.value = 0.65 + delay * 0.07;
      filter.type = "lowpass";
      filter.Q.value = 0.65;
      filter.frequency.setValueAtTime(
        event.water ? from * 0.45 : from,
        now + delay
      );
      filter.frequency.exponentialRampToValueAtTime(to, now + delay + length);
      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(level, now + delay + attack);
      gain.gain.exponentialRampToValueAtTime(1e-4, now + delay + length);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      nodes.push(filter, gain);
      register(source, delay, delay + length + 0.05);
    }
    noiseLayer(0, 0.7, 0.9, 4200, 450, 8e-3);
    noiseLayer(0.06, 4.5, 1.4, 1500, 90, 0.12);
    noiseLayer(0.35, duration - 0.4, 1.2, 240, 45, 0.5);
    noiseLayer(0.9, 3.5, 0.55, 650, 75, 0.2);
    noiseLayer(2.1, 4.5, 0.38, 380, 50, 0.3);
    for (const [hz, level, length] of [
      [105, 0.42, 2.8],
      [52, 0.32, 5.5]
    ]) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(hz, now);
      oscillator.frequency.exponentialRampToValueAtTime(25, now + length);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(1e-4, now + length);
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
          }
        }
      }
    };
  }

  // src/audio.ts
  var GameAudio = class {
    ctx;
    master;
    mix;
    blastNoise;
    nukeVoices = [];
    engine;
    engineGain;
    filter;
    voices = [];
    turbine;
    turbineGain;
    windGain;
    windFilter;
    volume = 0.35;
    muted = false;
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
        this.turbineGain.gain.value = 8e-3;
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
    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = this.muted ? 0 : v;
    }
    setMute(v) {
      this.muted = v;
      this.setVolume(this.volume);
    }
    pause() {
      this.ctx?.suspend().catch(() => {
      });
    }
    update(speed, p, forward, boost = false) {
      if (!this.ctx || !this.engine) return;
      this.engine.frequency.setTargetAtTime(
        45 + speed * 0.6,
        this.ctx.currentTime,
        0.2
      );
      this.filter.frequency.setTargetAtTime(
        180 + speed * 2,
        this.ctx.currentTime,
        0.2
      );
      const throttle = Math.max(0, Math.min(1, (speed - 35) / 85));
      this.engineGain.gain.setTargetAtTime(
        0.02 + throttle * 0.025,
        this.ctx.currentTime,
        0.25
      );
      this.turbine.frequency.setTargetAtTime(
        220 + throttle * 520 + (boost ? 130 : 0),
        this.ctx.currentTime,
        0.3
      );
      this.turbineGain.gain.setTargetAtTime(
        5e-3 + throttle * 8e-3,
        this.ctx.currentTime,
        0.3
      );
      this.windGain.gain.setTargetAtTime(
        0.012 + throttle * 0.07,
        this.ctx.currentTime,
        0.3
      );
      this.windFilter.frequency.setTargetAtTime(
        400 + throttle * 1100,
        this.ctx.currentTime,
        0.3
      );
      const l = this.ctx.listener;
      l.positionX.value = p[0];
      l.positionY.value = p[1];
      l.positionZ.value = p[2];
      l.forwardX.value = forward[0];
      l.forwardY.value = forward[1];
      l.forwardZ.value = forward[2];
      l.upY.value = 1;
    }
    noise(p, duration, gain, cutoff) {
      if (!this.ctx || !this.master) return;
      const c = this.ctx;
      if (this.voices.length >= 24) this.voices[0]();
      const source = c.createBufferSource();
      source.buffer = this.blastNoise;
      source.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      const volume = c.createGain();
      volume.gain.setValueAtTime(gain, c.currentTime);
      volume.gain.exponentialRampToValueAtTime(1e-4, c.currentTime + duration);
      const pan = c.createPanner();
      pan.distanceModel = "inverse";
      pan.refDistance = 100;
      pan.maxDistance = 2e3;
      pan.rolloffFactor = 0.9;
      pan.positionX.value = p[0];
      pan.positionY.value = p[1];
      pan.positionZ.value = p[2];
      source.connect(filter);
      filter.connect(volume);
      volume.connect(pan);
      pan.connect(this.mix);
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
    contact(e) {
      const timber = e.material === "wood" || e.material === "foliage";
      const settle = e.action === "settle";
      this.noise(
        e.p,
        settle ? 0.35 : timber ? 0.65 : 0.28,
        (settle ? 0.035 : 0.08) * Math.min(2, e.energy),
        timber ? settle ? 380 : 1250 : settle ? 1100 : 2600
      );
    }
    get stats() {
      return {
        ordinaryVoices: this.voices.length,
        nukeVoices: this.nukeVoices.length
      };
    }
    explosion(e) {
      if (e.kind === "nuke") {
        if (!this.ctx || !this.mix || !this.blastNoise) return;
        if (this.nukeVoices.length >= 4) this.nukeVoices.shift().stop();
        const voice = playNukeBlast(
          this.ctx,
          this.mix,
          this.blastNoise,
          e,
          () => {
            this.nukeVoices = this.nukeVoices.filter((v) => v !== voice);
          }
        );
        this.nukeVoices.push(voice);
        return;
      }
      this.noise(
        e.p,
        e.kind === "collapse" ? 2.5 : 1.7,
        e.kind === "collapse" ? 0.55 : 1,
        e.water ? 180 : 750
      );
    }
    launch(p, weapon = "cannon") {
      this.noise(
        p,
        weapon === "nuke" ? 0.45 : 0.22,
        weapon === "nuke" ? 0.3 : 0.2,
        weapon === "nuke" ? 420 : 1700
      );
    }
  };

  // src/config.ts
  var CONFIG = {
    version: 4,
    dt: 1 / 60,
    minSpeed: 35,
    maxSpeed: 90,
    boostSpeed: 120,
    turnSpeed: 1.05,
    pitchSpeed: 0.75,
    maxPitch: 1.12,
    ceiling: 500,
    fireCooldown: 1,
    projectileSpeed: 140,
    projectileGravity: 5,
    projectileLifetime: 8,
    craterRadius: 12,
    craterDepth: 5,
    bedrock: 25,
    damageRadius: 24,
    maxBodies: 256,
    maxFragments: 64,
    maxProjectiles: 12,
    maxRubblePerChunk: 36,
    respawnDelay: 2,
    worldSize: 2048,
    grid: 1025,
    spacing: 2,
    chunkSize: 64
  };
  var NUKE_PROFILES = {
    local: {
      damageRadius: 70,
      craterRadius: 35,
      depth: 12,
      cloudHeight: 120,
      bodyLimit: 128,
      scatterMin: 50,
      scatterMax: 85,
      ejecta: 720
    },
    castle: {
      damageRadius: 180,
      craterRadius: 70,
      depth: 20,
      cloudHeight: 240,
      bodyLimit: 128,
      scatterMin: 60,
      scatterMax: 105,
      ejecta: 1e3
    },
    valley: {
      damageRadius: 420,
      craterRadius: 160,
      depth: 25,
      cloudHeight: 400,
      bodyLimit: 128,
      scatterMin: 70,
      scatterMax: 120,
      ejecta: 1200
    }
  };

  // src/destruction-settings.ts
  var NUKE_LIMITS = [32, 128, 256, 512, 1024];
  var COSMETIC_SCALE = [0.25, 1, 1.5, 2, 3];
  var DEFAULT_DESTRUCTION = {
    bodies: 1,
    fragments: 1,
    cosmetics: 1,
    rubble: 1,
    noCooldown: false,
    nukeScale: 1
  };
  function nukeProfile(yieldId, settings) {
    const base = NUKE_PROFILES[yieldId], scale = settings.nukeScale;
    return {
      ...base,
      damageRadius: base.damageRadius * scale,
      craterRadius: base.craterRadius * scale,
      depth: Math.min(25, base.depth * scale),
      cloudHeight: base.cloudHeight * Math.sqrt(scale),
      bodyLimit: NUKE_LIMITS[settings.fragments],
      ejecta: Math.round(base.ejecta * COSMETIC_SCALE[settings.cosmetics])
    };
  }

  // checks/polish/audio-check.ts
  window.audioCheck = async () => {
    const Real = window.AudioContext;
    const ctx = new OfflineAudioContext(2, 48e3 * 15, 48e3);
    ctx.resume = async () => {
    };
    window.AudioContext = function() {
      return ctx;
    };
    try {
      const a = new GameAudio();
      await a.start();
      a.setVolume(1);
      a.update(120, [0, 10, 0], [0, 0, 1], true);
      for (let i = 0; i < 100; i++) a.contact({ type: "contactSound", p: [0, 10, 0], material: i % 2 ? "stone" : "wood", energy: 2, action: "impact" });
      const capped = a.stats;
      for (let i = 0; i < 8; i++) a.explosion({ type: "explosion", p: [0, 10, 0], water: false, power: 1, seed: i, kind: "nuke", yield: "valley", profile: nukeProfile("valley", DEFAULT_DESTRUCTION) });
      const overlap = a.stats;
      const b = await ctx.startRendering();
      let peak = 0, sum = 0;
      for (let c = 0; c < b.numberOfChannels; c++) for (const x of b.getChannelData(c)) {
        peak = Math.max(peak, Math.abs(x));
        sum += x * x;
      }
      return { capped, overlap, after: a.stats, peak, rms: Math.sqrt(sum / (b.length * b.numberOfChannels)) };
    } finally {
      window.AudioContext = Real;
    }
  };
})();
