import { get } from './api.js';
import { h, clear } from './ui.js';
import { renderExercises, renderExerciseForm } from './views/exercises.js';
import { renderSessions, renderSessionForm, renderSessionRead } from './views/sessions.js';
import { renderSessionRun } from './views/sessionRun.js';
import { renderCalendar } from './views/calendar.js';
import { renderHistory } from './views/history.js';
import { renderProfile } from './views/profile.js';
import { renderShared } from './views/shareView.js';
import { startNotificationScheduler } from './notifications.js';

export const state = { user: null };

const NAV = [
  ['#calendrier', 'Calendrier'],
  ['#exercices', 'Exercices'],
  ['#sessions', 'Sessions'],
  ['#historique', 'Historique'],
  ['#profil', 'Profil'],
];

const routes = [
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
  [/^#\/partage\/([A-Za-z0-9_-]+)$/, (m) => renderShared(m[1])],
];

function renderHeader() {
  const header = document.getElementById('app-header');
  clear(header);
  const inner = h('div', { class: 'header-inner' });
  inner.append(h('a', { class: 'brand', href: '#/calendrier' }, '🏋️ MobilRenfo-Session'));
  const nav = h('nav', { class: 'main-nav', 'aria-label': 'Navigation principale' });
  for (const [href, label] of NAV) {
    nav.append(h('a', { href, class: location.hash.startsWith(href) ? 'active' : '' }, label));
  }
  const who = h('div', { class: 'header-user' },
    h('span', {}, state.user?.name ? `👤 ${state.user.name}` : '💾 100 % local'));
  inner.append(nav, who);
  header.append(inner);
}

function currentRoute() {
  if (location.hash && location.hash.length > 1) return location.hash;
  const m = location.pathname.match(/^\/[^/]+\/(.*)$/);
  const rest = m ? m[1].replace(/\/+$/, '') : '';
  return rest ? `#/${rest}` : '#/calendrier';
}

async function route() {
  const main = document.getElementById('app-main');
  const hash = currentRoute();
  renderHeader();
  clear(main);
  const match = routes.find(([re]) => re.test(hash));
  if (!match) {
    location.hash = '#/calendrier';
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
  const { user } = await get('/api/auth/me');
  state.user = user;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
  startNotificationScheduler();
  if (!location.hash) location.hash = currentRoute();
  await route();
}

window.addEventListener('hashchange', route);
boot();
