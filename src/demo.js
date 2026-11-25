// Fake backend so the booth can be tried (and tested) without Spotify.
const TRACKS = [
  ['Midnight Circuit', 'Neon Atlas'], ['Low Orbit', 'Kaleid'], ['Velvet Static', 'Mira Vale'],
  ['Signal Fire', 'Northbound'], ['Prism Drive', 'Neon Atlas'], ['Afterhours Glow', 'Juno Park'],
  ['Gravity Lane', 'Kaleid'], ['Pulse Theory', 'Ravel & Rye'],
];
const LISTS = ['Warm Up', 'Peak Time', 'Late Night', 'Bass Lab', 'Throwbacks', 'Chill Down', 'Gym Mode', 'Road Trip', 'Focus', 'Party Mix'];

function art(i, title) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const h = (i * 47 + 290) % 360;
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, `hsl(${h},95%,55%)`); g.addColorStop(1, `hsl(${(h + 60) % 360},90%,18%)`);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 6;
  for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(128, 128, 30 + k * 22 + (i % 3) * 6, 0, Math.PI * 2); x.stroke(); }
  x.fillStyle = '#fff'; x.font = '900 26px system-ui,sans-serif'; x.textAlign = 'center';
  x.fillText(title.toUpperCase(), 128, 238);
  return c.toDataURL('image/png');
}

export class DemoBackend {
  constructor() {
    this.label = 'Demo';
    this.tracks = TRACKS.map(([n, a], i) => ({ id: 'demo' + i, uri: 'demo:track:' + i, name: n, artists: a, art: art(i, n), durationMs: (168 + i * 17) * 1000 }));
    this.lists = LISTS.map((n, i) => ({ uri: 'demo:playlist:' + i, name: n, art: art(i + 3, n) }));
    this.i = 0; this.pos = 42_000; this.playing = true; this.at = performance.now();
    this.vol = 70; this.shuf = false; this.rep = 'off'; this.saved = new Set();
    this.devices = [
      { id: 'mini', name: 'Mac mini', type: 'Computer', active: true },
      { id: 'phone', name: 'iPhone', type: 'Smartphone', active: false },
      { id: 'tv', name: 'Living Room TV', type: 'TV', active: false },
    ];
  }
  _tick() {
    const now = performance.now();
    if (this.playing) {
      this.pos += now - this.at;
      if (this.pos >= this.tracks[this.i].durationMs) { this.pos = 0; this.i = (this.i + 1) % this.tracks.length; }
    }
    this.at = now;
  }
  async me() { return 'demo DJ'; }
  async getState() {
    this._tick();
    const d = this.devices.find(x => x.active);
    return {
      isPlaying: this.playing, track: this.tracks[this.i], progressMs: this.pos, shuffle: this.shuf, repeat: this.rep,
      device: { id: d.id, name: d.name, supportsVolume: true, volume: this.vol }, fetchedAt: performance.now(),
    };
  }
  async getQueue() { return [1, 2, 3, 4, 5].map(k => this.tracks[(this.i + k) % this.tracks.length]); }
  async getPlaylists() { return this.lists; }
  async getDevices() { return this.devices.map(d => ({ ...d })); }
  async play() { this._tick(); this.playing = true; }
  async pause() { this._tick(); this.playing = false; }
  async next() { this._tick(); this.i = (this.i + 1) % this.tracks.length; this.pos = 0; }
  async prev() { this._tick(); if (this.pos > 3000) this.pos = 0; else this.i = (this.i + this.tracks.length - 1) % this.tracks.length; this.pos = 0; }
  async seek(ms) { this._tick(); this.pos = ms; }
  async volume(v) { this.vol = Math.round(v); }
  async shuffle(on) { this.shuf = on; }
  async repeat(m) { this.rep = m; }
  async playContext(uri) { this._tick(); this.i = Number(uri.split(':').pop()) % this.tracks.length; this.pos = 0; this.playing = true; }
  async transfer(id) { this.devices.forEach(d => { d.active = d.id === id; }); this.playing = true; }
  async isSaved(uri) { return this.saved.has(uri); }
  async save(uri) { this.saved.add(uri); }
  async unsave(uri) { this.saved.delete(uri); }
}
