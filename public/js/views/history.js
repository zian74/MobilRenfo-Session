import { get } from '../api.js';
import { h, clear, field, input, select, badge, emptyState, loading, formatDateFr, formatDuree } from '../ui.js';

const TYPES = [['', 'Tous les types'], ['renforcement', 'Renforcement'], ['mobilité', 'Mobilité'], ['mixte', 'Mixte'], ['libre', 'Séances libres']];

export async function renderHistory() {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(h('div', { class: 'page-title' }, h('h1', {}, 'Historique & statistiques')));

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const from = input('date', { value: monthStart });
  const to = input('date', { value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` });
  const type = select(TYPES);
  const groupe = select([['', 'Tous groupes musculaires']]);
  const toolbar = h('div', { class: 'toolbar card' },
    field('Du', from), field('Au', to), field('Type', type), field('Groupe musculaire', groupe));
  main.append(toolbar);

  const statsBox = h('div', { class: 'stats-grid' });
  const listBox = h('div', {});
  main.append(statsBox, h('h2', { style: 'font-size:1.1rem' }, 'Séances effectuées'), listBox);

  let facets = { groupes: [] };
  try { facets = await get('/api/exercises/facets'); } catch { /* ignore */ }
  for (const g of facets.groupes) groupe.append(h('option', { value: g }, g));

  async function load() {
    clear(statsBox).append(loading());
    clear(listBox).append(loading());
    const qs = new URLSearchParams();
    if (from.value) qs.set('from', from.value);
    if (to.value) qs.set('to', to.value);
    if (type.value) qs.set('type', type.value);
    if (groupe.value) qs.set('groupe', groupe.value);
    const qstr = qs.toString();
    let history, stats;
    try {
      [history, stats] = await Promise.all([get(`/api/history?${qstr}`), get(`/api/stats?${qstr}`)]);
    } catch (e) {
      clear(statsBox); clear(listBox);
      listBox.append(emptyState(e.message));
      return;
    }
    clear(statsBox);
    const s = stats.stats;
    const cards = [
      [String(s.totalSeances), 'séances effectuées'],
      [String(s.repetitionsTotales), 'répétitions totales'],
      [`${s.volumeTotal} kg`, 'volume total (séries × rép. × charge)'],
      [s.parSemaine.length ? `${s.parSemaine[s.parSemaine.length - 1].n} cette semaine` : '—', 'cette semaine'],
    ];
    for (const [v, l] of cards) {
      statsBox.append(h('div', { class: 'stat-card' }, h('div', { class: 'stat-value' }, v), h('div', { class: 'stat-label' }, l)));
    }
    if (s.repartition.length > 1) {
      const rep = s.repartition.map((r) => `${r.type} : ${r.n}`).join(' · ');
      statsBox.append(h('div', { class: 'stat-card', style: 'grid-column: 1 / -1' }, h('div', { class: 'stat-label' }, `Répartition — ${rep}`)));
    }

    clear(listBox);
    if (!history.history.length) {
      listBox.append(emptyState('Aucune séance effectuée sur la période.'));
      return;
    }
    for (const entry of history.history) {
      const details = h('details', { class: 'card history-entry' });
      const summary = h('summary', {},
        badge(entry.type === 'renforcement' ? 'Renforcement' : entry.type === 'mobilité' ? 'Mobilité' : entry.type === 'mixte' ? 'Mixte' : 'Libre', entry.type),
        ' ',
        h('strong', {}, entry.titre),
        ` — ${formatDateFr(entry.date)}${entry.heure ? ` à ${entry.heure}` : ''}${entry.duree_estimee ? ` · ${formatDuree(entry.duree_estimee)}` : ''}`);
      details.append(summary);
      if (entry.notes) details.append(h('p', { class: 'small muted' }, `Notes : ${entry.notes}`));
      if (entry.logs.length) {
        const table = h('table', { class: 'log-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Exercice'), h('th', {}, 'Séries'), h('th', {}, 'Rép.'), h('th', {}, 'Charge'), h('th', {}, 'Sensation'), h('th', {}, 'Commentaire'))),
          h('tbody', {}, ...entry.logs.map((l) => h('tr', {},
            h('td', {}, l.exercice),
            h('td', {}, l.series_realisees ?? '—'),
            h('td', {}, l.repetitions_realisees ?? '—'),
            h('td', {}, l.charge_utilisee || '—'),
            h('td', {}, l.sensation || '—'),
            h('td', {}, l.commentaire || '')))));
        details.append(table);
      } else {
        details.append(h('p', { class: 'small muted' }, 'Aucun détail par exercice.'));
      }
      listBox.append(details);
    }
  }

  for (const el of [from, to, type, groupe]) el.addEventListener('change', load);
  await load();
}
