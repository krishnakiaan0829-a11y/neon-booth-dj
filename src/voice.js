// MC mic: hears you talk (through the headset mic) and plays a synthesized crowd back.
// No recording, no speech-to-text: it only measures how loud the voice band is.
export class Voice {
  constructor() {
    this.ac = null; this.mic = null; this.asking = null;
    this.level = 0; this.floor = 0.2; this.talking = false; this.talkStart = 0;
    this.above = 0; this.quiet = 0; this.cheerGain = 0; this.peak = 0;
    this.onStart = null; this.onEnd = null;
  }

  // Call from a click so the browser lets audio play.
  wake() {
    if (!this.ac) {
      try { this.ac = new AudioContext(); } catch { return; }
      const out = this.ac.createGain(); out.gain.value = 0.9; out.connect(this.ac.destination);
      this.out = out;
      const len = this.ac.sampleRate * 2, buf = this.ac.createBuffer(1, len, this.ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    this.ac.resume().catch(() => {});
  }

  get micOn() { return !!this.mic; }

  async enableMic() {
    if (this.mic) return true;
    this.asking ??= (async () => {
      try {
        this.wake();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const an = this.ac.createAnalyser();
        an.fftSize = 1024; an.smoothingTimeConstant = 0.3;
        this.ac.createMediaStreamSource(stream).connect(an);
        this.mic = { stream, an, buf: new Uint8Array(an.frequencyBinCount) };
        return true;
      } catch (e) { console.warn('voice mic unavailable', e); return false; }
      finally { this.asking = null; }
    })();
    return this.asking;
  }

  disableMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach(t => t.stop());
    this.mic = null; this.level = 0;
    if (this.talking) this._end(performance.now());
  }

  // Once per frame while the mic is in your hand.
  update(dt) {
    if (!this.mic) return;
    const { an, buf } = this.mic, now = performance.now();
    an.getByteFrequencyData(buf);
    const binHz = this.ac.sampleRate / an.fftSize;
    const lo = Math.round(300 / binHz), hi = Math.round(3000 / binHz);
    let s = 0; for (let i = lo; i <= hi; i++) s += buf[i];
    const lvl = s / ((hi - lo + 1) * 255);
    this.level = this.level * 0.6 + lvl * 0.4;
    // Room noise sets the floor; our own crowd sound pushes the bar up so it can't trigger itself.
    if (!this.talking) this.floor += (Math.min(this.level, this.floor + 0.05) - this.floor) * Math.min(1, dt * 0.8);
    const bar = Math.max(0.22, this.floor + 0.11) + 0.15 * this.cheerGain;
    if (this.level > bar) { this.above += dt; this.quiet = 0; } else { this.quiet += dt; this.above = 0; }
    if (this.talking) this.peak = Math.max(this.peak, this.level);
    if (!this.talking && this.above > 0.12) { this.talking = true; this.talkStart = now; this.peak = this.level; this.onStart?.(); }
    if (this.talking && this.quiet > 0.45) this._end(now);
  }
  _end(now) {
    this.talking = false;
    this.onEnd?.((now - this.talkStart) / 1000);
  }

  // A stadium answering: a noise roar, a few "woo"s and some claps.
  cheer(size = 0.7) {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime, dur = 2.2 + size * 2.5;
    const roar = ac.createBufferSource(); roar.buffer = this.noise; roar.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.linearRampToValueAtTime(3800, t + 0.5); lp.frequency.linearRampToValueAtTime(1500, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 + 0.35 * size, t + 0.35);
    g.gain.setValueAtTime(0.3 + 0.3 * size, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    roar.connect(bp).connect(lp).connect(g).connect(this.out);
    roar.start(t); roar.stop(t + dur + 0.1);

    const woos = 4 + Math.round(size * 6);
    for (let k = 0; k < woos; k++) {
      const at = t + 0.1 + Math.random() * dur * 0.5, len = 0.5 + Math.random() * 0.7;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const f = 330 + Math.random() * 420;
      o.frequency.setValueAtTime(f, at); o.frequency.linearRampToValueAtTime(f * 1.5, at + len * 0.35); o.frequency.linearRampToValueAtTime(f * 1.1, at + len);
      const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 1.2;
      const og = ac.createGain();
      og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(0.025, at + 0.08); og.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(f2).connect(og).connect(this.out); o.start(at); o.stop(at + len + 0.05);
    }
    const claps = Math.round(20 + size * 50);
    for (let k = 0; k < claps; k++) {
      const at = t + 0.2 + Math.random() * dur * 0.7;
      const src = ac.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.8 + Math.random() * 0.6;
      const hp = ac.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1500 + Math.random() * 1500; hp.Q.value = 1;
      const cg = ac.createGain();
      cg.gain.setValueAtTime(0.06 + Math.random() * 0.05, at); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      src.connect(hp).connect(cg).connect(this.out); src.start(at, Math.random()); src.stop(at + 0.08);
    }
  }
}
