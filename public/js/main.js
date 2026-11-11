import { get } from './api.js';
import { h, clear } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderExercises, renderExerciseForm } from './views/exercises.js';
import { renderSessions, renderSessionForm, renderSessionRead } from './views/sessions.js';
import { renderSessionRun } from './views/sessionRun.js';
import { renderCalendar } from './views/calendar.js';
import { renderHistory } from './views/history.js';
import { renderProfile } from './views/profile.js';

export const state = { user: null, booting: true };

const NAV = [
  ['#/calendrier', 'Calendrier'],
  ['#/exercices', 'Exercices'],
  ['#/sessions', 'Sessions'],
  ['#/historique', 'Historique'],
  ['#/profil', 'Profil'],
];

const PUBLIC_ROUTES = new Set(['#/connexion', '#/inscription']);

const routes = [
  [/^#\/connexion$/, () => renderAuth('login')],
  [/^#\/inscription$/, () => renderAuth('register')],
  [/^#\/exercices$/, () => renderExercises()],
  [/^#\/exercices\/nouveau$/, () => renderExerciseForm(null)],
  [/^#\/exercices\/(\d+)$/, (m) => renderExerciseForm(Number(m[1]))],
  [/^#\/sessions$/, () => renderSessions()],
  [/^#\/sessions\/nouvelle$/, () => renderSessionForm(null)],
  [/^#\/sessions\/(\d+)\/lecture$/, (m) => renderSessionRead(Number(m[1]))],
  [/^#\/sessions\/(\d+)$/, (m) => renderSessionForm(Number(m[1]))],
  [/^#\/seance\/(\d+)$/, (m) => renderSessionRun(Number(m[1]))],
  [/^#\/calendrier$/, () => renderCalendar()],
  [/^#\/historique$/, () => renderHistory()],
  [/^#\/profil$/, () => renderProfile()],
];

function renderHeader() {
  const header = document.getElementById('app-header');
  clear(header);
  const inner = h('div', { class: 'header-inner' });
  inner.append(h('a', { class: 'brand', href: state.user ? '#/calendrier' : '#/connexion' }, '🏋️ MobilRenfo-Session'));
  if (state.user) {
    const nav = h('nav', { class: 'main-nav', 'aria-label': 'Navigation principale' });
    for (const [href, label] of NAV) {
      nav.append(h('a', { href, class: location.hash.startsWith(href) ? 'active' : '' }, label));
    }
    const who = h('div', { class: 'header-user' }, h('span', {}, state.user.name || state.user.email));
    inner.append(nav, who);
  }
  header.append(inner);
}

async function route() {
  const main = document.getElementById('app-main');
  const hash = !location.hash || location.hash === '#' ? '#/calendrier' : (location.hash.startsWith('#/') ? location.hash : `#/${location.hash.slice(1)}`);
  renderHeader();
  if (!state.user && !PUBLIC_ROUTES.has(hash)) {
    location.hash = '#/connexion';
    return;
  }
  if (state.user && PUBLIC_ROUTES.has(hash)) {
    location.hash = '#/calendrier';
    return;
  }
  clear(main);
  const match = routes.find(([re]) => re.test(hash));
  if (!match) {
    location.hash = state.user ? '#/calendrier' : '#/connexion';
    return;
  }
  try {
    await match[1](match[0].exec(hash));
  } catch (e) {
    main.append(h('div', { class: 'card' }, h('p', {}, e.message || 'Erreur inattendue')));
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    const { user } = await get('/api/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  state.booting = false;
  if (!location.hash) location.hash = state.user ? '#/calendrier' : '#/connexion';
  await route();
}

window.addEventListener('hashchange', route);
boot();

export function requireUser() {
  return state.user;
}
