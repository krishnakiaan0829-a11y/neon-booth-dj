// Beat clock for the light show. Spotify gives no audio or tempo data, so the
// beat comes from tap tempo, or from the headset mic hearing the speakers.
export class Beat {
  constructor() {
    this.bpm = 124;
    this.t0 = performance.now();
    this.idx = 0;
    this.taps = [];
    this.mic = null;
    this.avg = 0;
    this.level = 0;
    this.lastKick = 0;
    this.lastBeatAt = performance.now();
    this.pulse = 0;
  }

  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length >= 2) {
      const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      this.bpm = Math.round(Math.min(200, Math.max(60, 60000 / iv)));
    }
    this.t0 = now; this.idx = 0; this.lastBeatAt = now;
    return this.bpm;
  }

  get micOn() { return !!this.mic; }

  async enableMic() {
    if (this.mic) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ac = new AudioContext();
      await ac.resume();
      const an = ac.createAnalyser();
      an.fftSize = 1024; an.smoothingTimeConstant = 0.15;
      ac.createMediaStreamSource(stream).connect(an);
      this.mic = { stream, ac, an, buf: new Uint8Array(an.frequencyBinCount) };
      return true;
    } catch (e) {
      console.warn('mic unavailable', e);
      return false;
    }
  }

  disableMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach(t => t.stop());
    this.mic.ac.close();
    this.mic = null;
    this.level = 0;
  }

  // Call once per frame. Returns true on a beat.
  update() {
    const now = performance.now();
    let beat = false;
    if (this.mic) {
      const { an, buf } = this.mic;
      an.getByteFrequencyData(buf);
      const binHz = this.mic.ac.sampleRate / an.fftSize;
      const lo = Math.max(1, Math.round(40 / binHz)), hi = Math.max(lo + 1, Math.round(160 / binHz));
      let low = 0; for (let i = lo; i <= hi; i++) low += buf[i];
      low /= (hi - lo + 1) * 255;
      let all = 0; for (let i = 1; i < 180; i++) all += buf[i];
      this.level = this.level * 0.7 + (all / (179 * 255)) * 0.3;
      this.avg = this.avg * 0.96 + low * 0.04;
      if (low > this.avg * 1.22 + 0.03 && low > 0.22 && now - this.lastKick > 270) {
        this.lastKick = now; beat = true;
      }
    }
    // The clock carries the show whenever the mic hears no kicks.
    if (!this.mic || now - this.lastKick > 2000) {
      const idx = Math.floor((now - this.t0) / (60000 / this.bpm));
      if (idx !== this.idx) { this.idx = idx; beat = true; }
    }
    if (beat) this.lastBeatAt = now;
    this.pulse = Math.exp(-((now - this.lastBeatAt) / 1000) * 5.5);
    return beat;
  }
}
