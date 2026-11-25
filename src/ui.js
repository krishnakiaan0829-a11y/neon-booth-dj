// Small helpers: canvas textures, album-art loading, text fitting, colour pick.
import * as THREE from 'three';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, ctx, tex, w, h, update() { tex.needsUpdate = true; } };
}

export const hsl = (h, s, l, a = 1) => `hsla(${(((h % 1) + 1) % 1) * 360},${s * 100}%,${l * 100}%,${a})`;

// Album art. Spotify's image CDN sends CORS headers; if one ever doesn't, the
// image fails to load and callers draw a placeholder instead.
const pending = new Map();
const loaded = new Map();
export function whenImage(url) {
  if (!url) return Promise.resolve(null);
  if (!pending.has(url)) {
    pending.set(url, new Promise(res => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => { loaded.set(url, im); res(im); };
      im.onerror = () => { loaded.set(url, null); res(null); };
      im.src = url;
    }));
  }
  return pending.get(url);
}
export function getImage(url) {          // loaded image or null (and starts the load)
  if (!url) return null;
  if (loaded.has(url)) return loaded.get(url);
  whenImage(url);
  return null;
}

export function ellipsize(ctx, text, maxW) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

// Cover image, or a generated gradient tile when there is no image.
export function drawCover(ctx, img, x, y, w, h, seed = '', hue = 0.85) {
  if (img) { ctx.drawImage(img, x, y, w, h); return; }
  let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const hh = (hue + (s % 100) / 300) % 1;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, hsl(hh, 0.9, 0.45)); g.addColorStop(1, hsl(hh + 0.15, 0.9, 0.12));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = `900 ${Math.round(h * 0.34)}px system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const initials = String(seed).split(/\s+/).filter(Boolean).slice(0, 2).map(t => t[0]).join('').toUpperCase() || '♪';
  ctx.fillText(initials, x + w / 2, y + h / 2);
}

// Dominant saturated hue of an image, 0..1, or null.
export function hueOf(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let sx = 0, sy = 0, wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx - mn;
      if (s < 0.15 || mx < 0.15) continue;
      let h = mx === r ? (g - b) / s : mx === g ? (b - r) / s + 2 : (r - g) / s + 4;
      h /= 6;
      const w = s * mx;
      sx += Math.cos(h * 2 * Math.PI) * w; sy += Math.sin(h * 2 * Math.PI) * w; wsum += w;
    }
    if (wsum < 1) return null;
    let h = Math.atan2(sy, sx) / (2 * Math.PI); if (h < 0) h += 1;
    return h;
  } catch { return null; }
}

export function fmtTime(ms) {
  ms = Math.max(0, ms | 0);
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
