import { h, clear } from '../ui.js';
import { decodeShare } from '../share.js';
import { buildReadSheet } from './sessions.js';

export function renderShared(payload) {
  const main = document.getElementById('app-main');
  clear(main);
  let session;
  try {
    const data = decodeShare(payload);
    if (!data || data.v !== 1 || !data.nom) throw new Error('bad');
    session = {
      nom: String(data.nom),
      description: String(data.description || ''),
      type: data.type || 'mixte',
      duree_estimee: data.duree_estimee ?? null,
      echauffement: String(data.echauffement || ''),
      retour_au_calme: String(data.retour_au_calme || ''),
      items: (Array.isArray(data.items) ? data.items : []).map((it, i) => ({
        id: i + 1,
        ordre: i,
        exercise_nom: it.nom || 'Bloc libre',
        nom_libre: '',
        series: it.series ?? null,
        repetitions: it.repetitions ?? null,
        temps_travail: it.temps_travail ?? null,
        repos: it.repos ?? null,
        charge: it.charge || '',
        notes: it.notes || '',
      })),
    };
  } catch {
    main.append(h('div', { class: 'card' }, h('p', {}, 'Lien de partage invalide ou corrompu.')));
    return;
  }
  const banner = h('div', { class: 'run-banner' },
    h('div', {}, h('strong', {}, '🔗 Fiche partagée — lecture seule'), h('div', { class: 'small' }, 'Partagée par lien, aucune donnée locale modifiée.')),
    h('a', { class: 'btn small primary', href: '#/calendrier' }, 'Ouvrir mon app'));
  main.append(banner, buildReadSheet(session, { readOnly: true }));
}
