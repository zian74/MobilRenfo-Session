const mem = new Map();
const hasLS = typeof localStorage !== 'undefined' && localStorage !== null;

export function loadJSON(key, fallback) {
  try {
    if (hasLS) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }
    return mem.has(key) ? mem.get(key) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  if (hasLS) {
    try { localStorage.setItem(key, JSON.stringify(value)); return; } catch { /* quota dépassé */ }
  }
  mem.set(key, value);
}

export function removeKey(key) {
  if (hasLS) localStorage.removeItem(key);
  mem.delete(key);
}
