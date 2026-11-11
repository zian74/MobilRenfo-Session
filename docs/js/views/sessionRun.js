import { get } from '../api.js';
import { h, clear, badge, loading, formatDateFr, formatDuree, toast } from '../ui.js';
import { buildReadSheet } from './sessions.js';
import { openLogModal } from './logModal.js';

export async function renderSessionRun(plannedId) {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let planned;
  try {
    planned = (await get(`/api/planned/${plannedId}`)).planned;
  } catch (e) {
    clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
    return;
  }
  let session = null;
  if (planned.session_id) {
    try { session = (await get(`/api/sessions/${planned.session_id}`)).session; } catch { session = null; }
  }
  clear(main);

  const banner = h('div', { class: `run-banner ${planned.effectuee ? 'done' : ''}` },
    h('div', {},
      h('strong', {}, planned.session_nom || planned.titre_libre || 'Séance libre'),
      h('div', { class: 'small' }, `${formatDateFr(planned.occurrenceDate || planned.date)}${planned.heure ? ` à ${planned.heure}` : ''}`
        + (planned.recurrence !== 'none' ? ` · récurrente (${planned.recurrence === 'custom' ? (planned.jours || []).length + ' j/sem.' : planned.recurrence === 'daily' ? 'quotidienne' : 'hebdomadaire'})` : '')
        + (planned.fin_recurrence ? ` · jusqu’au ${formatDateFr(planned.fin_recurrence)}` : ''))),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: '#/calendrier' }, '← Calendrier'),
      session ? h('button', {
        class: `btn small primary`,
        onclick: () => openLogModal(planned, session, { onSaved: () => renderSessionRun(plannedId) }),
      }, planned.effectuee ? '📋 Modifier le bilan' : '✅ Marquer effectuée + bilan') : null));
  main.append(banner);

  if (session) {
    main.append(buildReadSheet(session, {
      extraActions: h('button', {
        class: 'btn primary',
        onclick: () => openLogModal(planned, session, { onSaved: () => renderSessionRun(plannedId) }),
      }, planned.effectuee ? '📋 Voir / modifier le bilan' : '✅ Marquer la séance effectuée'),
    }));
  } else {
    main.append(h('div', { class: 'card' },
      h('h1', { style: 'font-size:1.3rem;margin-top:0' }, planned.titre_libre || 'Séance libre'),
      planned.notes ? h('p', { class: 'muted' }, planned.notes) : h('p', { class: 'muted' }, 'Séance libre, sans fiche associée.'),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', onclick: () => openLogModal(planned, null, { onSaved: () => renderSessionRun(plannedId) }) },
          planned.effectuee ? '📋 Voir / modifier le bilan' : '✅ Marquer effectuée + bilan'))));
  }

  if (planned.effectuee) toast('Cette séance est déjà marquée comme effectuée', '');
}
