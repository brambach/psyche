// What the town sounds like. There are no audio files: everything is made in the browser from
// filtered noise and a few oscillators. The sea washes in and out, the wind rises with the weather,
// rain hisses, the fire crackles when you are near it, small birds call in the morning, crickets at
// night, and thunder follows lightning after a pause. It is off until someone turns it on (browsers
// only let a page make sound after a click).

import type { SkyState } from "@psyche/engine";

export interface Soundscape {
  sky: SkyState;
  dark: number;
  fireLit: boolean;
  season: string;
  /** How high the camera is, how far from the fire, and how far the view's centre is from the shore. */
  height: number;
  fireDist: number;
  shoreDist: number;
  /** People sitting at the fire. */
  people: number;
}

type Ctx = AudioContext;

export class Ambience {
  private ctx?: Ctx;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private layers?: { sea: GainNode; swell: OscillatorNode; wind: GainNode; windTone: BiquadFilterNode; rain: GainNode; fire: GainNode; crickets: GainNode };
  private on = false;
  private until = { chirp: 3, crackle: 0 };
  private last?: Soundscape;

  /** Turn the sound on or off. The first "on" must come from a click, which is when the audio starts. */
  enable(on: boolean) {
    this.on = on;
    if (on && !this.ctx) this.build();
    if (!this.ctx || !this.master) return;
    if (on) void this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.4);
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    master.connect(ctx.destination);
    // Two seconds of noise, looped, feeds everything that hisses or roars.
    const buf = (this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate));
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const bed = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      return { gain, filter };
    };
    // The sea: low noise whose loudness swells and falls every eight seconds or so.
    const sea = bed("lowpass", 520, 0.4);
    const wash = ctx.createGain();
    wash.gain.value = 0;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.12;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    swell.connect(depth).connect(wash.gain);
    swell.start();
    sea.gain.disconnect();
    sea.gain.connect(wash).connect(master);
    sea.gain.connect(master);
    const wind = bed("bandpass", 420, 0.7);
    const rain = bed("highpass", 3200, 0.3);
    const fire = bed("bandpass", 900, 0.9);
    // Crickets: a high tone chopped fast, the chopping itself coming and going.
    const tone = ctx.createOscillator();
    tone.frequency.value = 4300;
    const chop = ctx.createGain();
    chop.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 27;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(chop.gain);
    const crickets = ctx.createGain();
    crickets.gain.value = 0;
    tone.connect(chop).connect(crickets).connect(master);
    tone.start();
    lfo.start();
    this.layers = { sea: sea.gain, swell, wind: wind.gain, windTone: wind.filter, rain: rain.gain, fire: fire.gain, crickets };
  }

  /** A short burst of filtered noise with a sharp attack: a crackle, or (long and low) thunder. */
  private burst(freq: number, type: BiquadFilterType, peak: number, decay: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    const at = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + Math.min(0.03, decay * 0.1));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(at, Math.random());
    src.stop(at + decay + 0.1);
  }

  /** Thunder for a lightning strike: the further off, the later, lower and longer. */
  thunder(far: number) {
    if (!this.on) return;
    this.burst(260 - far * 150, "lowpass", 1.1 - far * 0.6, 2.2 + far * 2.5, 0.25 + far * 2.8);
    this.burst(90, "lowpass", 0.8 - far * 0.4, 4 + far * 2, 0.5 + far * 2.8);
  }

  /** A small bird: two to four quick rising notes. */
  private chirp() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const base = 2400 + Math.random() * 1600, notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const at = ctx.currentTime + i * (0.09 + Math.random() * 0.05);
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.setValueAtTime(base * (1 + i * 0.06), at);
      osc.frequency.exponentialRampToValueAtTime(base * (1.25 + i * 0.06), at + 0.07);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.05, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
      osc.connect(gain).connect(this.master);
      osc.start(at);
      osc.stop(at + 0.1);
    }
  }

  update(dt: number, s: Soundscape) {
    this.last = s;
    const ctx = this.ctx, L = this.layers;
    if (!ctx || !L || !this.on) return;
    const now = ctx.currentTime;
    // From high up everything is fainter.
    const near = Math.max(0.25, Math.min(1, 1 - (s.height - 40) / 260));
    const rain = s.sky.precip === "rain" ? s.sky.intensity : 0;
    const shore = Math.max(0.15, 1 - s.shoreDist / 150);
    L.sea.gain.setTargetAtTime((0.1 + 0.16 * s.sky.wind.speed) * shore * near, now, 0.5);
    L.swell.frequency.setTargetAtTime(0.1 + s.sky.wind.speed * 0.12, now, 1);
    L.wind.gain.setTargetAtTime((0.015 + 0.42 * s.sky.wind.speed * s.sky.wind.speed) * (0.6 + 0.4 * near), now, 0.8);
    L.windTone.frequency.setTargetAtTime(320 + 500 * s.sky.wind.speed + 120 * Math.sin(now * 0.31) + 80 * Math.sin(now * 0.83), now, 0.6);
    L.rain.gain.setTargetAtTime(rain * 0.16 * near + (s.sky.precip === "snow" ? 0.004 : 0), now, 0.7);
    const fire = s.fireLit ? Math.max(0, 1 - s.fireDist / 70) : 0;
    L.fire.gain.setTargetAtTime(fire * fire * 0.05, now, 0.3);
    const warm = s.season !== "winter";
    L.crickets.gain.setTargetAtTime(warm && s.dark > 0.7 && rain === 0 && s.sky.wind.speed < 0.5 ? 0.012 * near * (0.6 + 0.4 * Math.sin(now * 0.7)) : 0, now, 1.5);
    // Crackles from the fire, more of them close up.
    this.until.crackle -= dt;
    if (fire > 0.05 && this.until.crackle <= 0) {
      this.until.crackle = 0.04 + Math.random() * 0.35;
      this.burst(1500 + Math.random() * 3500, "highpass", 0.03 + Math.random() * 0.1 * fire * fire, 0.02 + Math.random() * 0.05);
    }
    // Birds: most at dawn, some through the day, none in rain or a gale or the dead of winter nights.
    this.until.chirp -= dt;
    if (this.until.chirp <= 0) {
      const dawn = s.sky.phase === "dawn" ? 1 : 0;
      this.until.chirp = (dawn ? 0.5 : 2.5) + Math.random() * (dawn ? 2 : 7) * (s.season === "winter" ? 3 : 1);
      if (s.sky.daylight > 0.25 && rain === 0 && s.sky.wind.speed < 0.6 && near > 0.4) this.chirp();
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
