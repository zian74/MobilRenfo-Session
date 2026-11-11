import { get } from './api.js';
import { loadJSON, saveJSON } from './storage.js';

const NOTIFIED_KEY = 'mrs-notified-v1';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function checkNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const today = todayIso();
  const { planned } = await get(`/api/planned?from=${today}&to=${today}`);
  const notified = loadJSON(NOTIFIED_KEY, {});
  let changed = false;
  const now = new Date();
  for (const p of planned) {
    if (!p.rappel?.actif || !p.heure) continue;
    const key = `${p.id}|${p.occurrenceDate}`;
    if (notified[key]) continue;
    const [hh, mm] = p.heure.split(':').map(Number);
    const at = new Date(now);
    at.setHours(hh, mm - (p.rappel.minutes ?? 15), 0, 0);
    if (now >= at) {
      notified[key] = true;
      changed = true;
      try {
        new Notification('🏋️ Séance prévue', {
          body: `${p.session_nom || p.titre_libre || 'Séance'} à ${p.heure} — rappel ${p.rappel.minutes ?? 15} min avant`,
          tag: key,
        });
      } catch { /* notifications indisponibles */ }
    }
  }
  if (changed) saveJSON(NOTIFIED_KEY, notified);
}

export function startNotificationScheduler() {
  if (typeof window === 'undefined') return;
  checkNotifications().catch(() => {});
  setInterval(() => checkNotifications().catch(() => {}), 30_000);
}
