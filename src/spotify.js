// Spotify Web API: PKCE login (no client secret in the browser) and playback control.
// Player endpoints need Spotify Premium. Search max limit is 10 since Feb 2026.
export const CLIENT_ID = 'c2fc3aabfe424419bb157c3499cfc5e0';
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read', 'user-library-modify',
].join(' ');
const TOK = 'neonbooth.tokens', VER = 'neonbooth.verifier';
const API = 'https://api.spotify.com/v1';

export const redirectUri = () => location.origin + location.pathname;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function loadTokens() { try { return JSON.parse(localStorage.getItem(TOK)); } catch { return null; } }
function saveTokens(j, prev) {
  const t = { access: j.access_token, refresh: j.refresh_token || prev?.refresh, exp: Date.now() + j.expires_in * 1000 };
  try { localStorage.setItem(TOK, JSON.stringify(t)); } catch {}
  return t;
}
export const hasLogin = () => !!loadTokens()?.refresh;
export function logout() { try { localStorage.removeItem(TOK); } catch {} }

export async function login() {
  const rnd = new Uint8Array(48); crypto.getRandomValues(rnd);
  const verifier = b64url(rnd);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(VER, verifier);
  const p = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}

// Finishes the login after Spotify redirects back with ?code=…
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), err = q.get('error');
  if (!code && !err) return {};
  history.replaceState(null, '', redirectUri());
  if (err) return { error: err };
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
      client_id: CLIENT_ID, code_verifier: localStorage.getItem(VER) || '',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.error_description || j.error || `HTTP ${r.status}` };
  saveTokens(j);
  return { ok: true };
}

let refreshing = null;
async function refresh() {
  const t = loadTokens();
  if (!t?.refresh) throw new ApiError(401, 'NOT_LOGGED_IN', 'Not logged in');
  refreshing ??= (async () => {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: CLIENT_ID }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { logout(); throw new ApiError(401, 'REFRESH_FAILED', j.error_description || 'Login expired'); }
    return saveTokens(j, t);
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function accessToken() {
  let t = loadTokens();
  if (!t) throw new ApiError(401, 'NOT_LOGGED_IN', 'Not logged in');
  if (Date.now() > t.exp - 60_000) t = await refresh();
  return t.access;
}

export class ApiError extends Error {
  constructor(status, reason, message) { super(message); this.status = status; this.reason = reason; }
}

async function api(method, path, body, retry = true) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + await accessToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) { await refresh(); return api(method, path, body, false); }
  if (r.status === 429 && retry) {
    const wait = Math.min(10, Number(r.headers.get('Retry-After')) || 2);
    await new Promise(res => setTimeout(res, wait * 1000));
    return api(method, path, body, false);
  }
  if (r.status === 204) return null;
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const e = j?.error || {};
    throw new ApiError(r.status, e.reason || '', e.message || `Spotify said ${r.status}`);
  }
  return j;
}

function mapTrack(it) {
  if (!it) return null;
  return {
    id: it.id || it.uri, uri: it.uri, name: it.name,
    artists: (it.artists || []).map(a => a.name).join(', ') || it.show?.name || '',
    art: it.album?.images?.[0]?.url || it.images?.[0]?.url || it.show?.images?.[0]?.url || null,
    durationMs: it.duration_ms || 0,
  };
}

export class SpotifyBackend {
  constructor() { this.label = 'Spotify'; }
  async me() { const j = await api('GET', '/me'); return j?.display_name || j?.id || 'you'; }
  async getState() {
    const j = await api('GET', '/me/player?additional_types=episode');
    if (!j) return null;
    return {
      isPlaying: !!j.is_playing, track: mapTrack(j.item), progressMs: j.progress_ms || 0,
      shuffle: !!j.shuffle_state, repeat: j.repeat_state || 'off',
      device: j.device ? { id: j.device.id, name: j.device.name, supportsVolume: j.device.supports_volume !== false, volume: j.device.volume_percent } : null,
      fetchedAt: performance.now(),
    };
  }
  async getQueue() { const j = await api('GET', '/me/player/queue'); return (j?.queue || []).slice(0, 6).map(mapTrack); }
  async getPlaylists() {
    const j = await api('GET', '/me/playlists?limit=50');
    return (j?.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name, art: p.images?.[0]?.url || null }));
  }
  async getDevices() {
    const j = await api('GET', '/me/player/devices');
    return (j?.devices || []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active }));
  }
  play() { return api('PUT', '/me/player/play'); }
  pause() { return api('PUT', '/me/player/pause'); }
  next() { return api('POST', '/me/player/next'); }
  prev() { return api('POST', '/me/player/previous'); }
  seek(ms) { return api('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`); }
  volume(v) { return api('PUT', `/me/player/volume?volume_percent=${Math.round(Math.min(100, Math.max(0, v)))}`); }
  shuffle(on) { return api('PUT', `/me/player/shuffle?state=${on}`); }
  repeat(mode) { return api('PUT', `/me/player/repeat?state=${mode}`); }
  playContext(uri) { return api('PUT', '/me/player/play', { context_uri: uri }); }
  transfer(id) { return api('PUT', '/me/player', { device_ids: [id], play: true }); }
  async isSaved(uri) { const j = await api('GET', `/me/library/contains?uris=${encodeURIComponent(uri)}`); return !!j?.[0]; }
  save(uri) { return api('PUT', `/me/library?uris=${encodeURIComponent(uri)}`); }
  unsave(uri) { return api('DELETE', `/me/library?uris=${encodeURIComponent(uri)}`); }
}
