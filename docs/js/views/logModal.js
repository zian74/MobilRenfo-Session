import { get, post } from '../api.js';
import { h, clear, field, input, select, textarea, errorBox, toast, modal } from '../ui.js';
import { formatDateFr } from '../ui.js';

export async function openLogModal(p, session, { onSaved } = {}) {
  const items = session?.items ?? [];
  let prevLogs = [];
  try {
    const hist = (await get('/api/history')).history.find((hh) => hh.id === p.id);
    prevLogs = hist?.logs ?? [];
  } catch { /* pas encore de bilan */ }
  if (!prevLogs.length && session) {
    prevLogs = items.map((it) => ({
      session_exercise_id: it.id,
      series_realisees: it.series ?? it.exercise_series_defaut ?? null,
      repetitions_realisees: it.repetitions ?? it.exercise_repetitions_defaut ?? null,
      charge_utilisee: it.charge || it.exercise_charge_conseille || '',
    }));
  }

  const rows = [];
  const err = h('div', {});
  const content = h('form', {});
  content.append(h('p', { class: 'small muted' }, `Bilan de « ${p.session_nom || p.titre_libre || 'séance'} » du ${formatDateFr(p.occurrenceDate || p.date)}`));

  function makeRow(label, itemId, prev) {
    const series = input('number', { min: 0, placeholder: 'séries', value: prev?.series_realisees ?? '' });
    const reps = input('number', { min: 0, placeholder: 'rép.', value: prev?.repetitions_realisees ?? '' });
    const charge = input('text', { placeholder: 'charge', maxlength: 60, value: prev?.charge_utilisee ?? '' });
    const sensation = select([['', 'Sensation…'], ['facile', 'Facile'], ['correct', 'Correct'], ['difficile', 'Difficile'], ['très difficile', 'Très difficile']], { value: prev?.sensation ?? '' });
    const commentaire = input('text', { placeholder: 'commentaire', maxlength: 1000, value: prev?.commentaire ?? '' });
    const row = h('div', { class: 'session-item' },
      h('div', { class: 'si-head' }, h('h4', {}, label)),
      h('div', { class: 'field-row' },
        field('Séries réalisées', series), field('Répétitions réalisées', reps), field('Charge utilisée', charge)),
      h('div', { class: 'field-row' }, field('Sensation', sensation), field('Commentaire', commentaire)));
    rows.push({
      get: () => ({
        session_exercise_id: itemId ?? null,
        exercice: label,
        series_realisees: series.value === '' ? null : Number(series.value),
        repetitions_realisees: reps.value === '' ? null : Number(reps.value),
        charge_utilisee: charge.value.trim(),
        sensation: sensation.value,
        commentaire: commentaire.value.trim(),
      }),
    });
    return row;
  }

  if (session && items.length) {
    items.forEach((it) => {
      const prev = prevLogs.find((l) => l.session_exercise_id === it.id);
      content.append(makeRow(it.exercise_nom || it.nom_libre || 'Bloc libre', it.id, prev));
    });
  } else {
    content.append(makeRow(p.session_nom || p.titre_libre || 'Séance libre', null, prevLogs[0]));
  }

  const notes = textarea({ rows: 2, placeholder: 'Notes sur la séance (optionnel)' });
  notes.value = p.notes ?? '';
  content.append(err, field('Notes de la séance', notes),
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, 'Enregistrer le bilan (séance effectuée)'),
      h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Annuler')));

  const m = modal({ title: 'Bilan de la séance', content, wide: true });
  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    try {
      await post(`/api/planned/${p.id}/logs`, {
        logs: rows.map((r) => r.get()).filter((l) => l.exercice),
        notes: notes.value.trim(),
        marquer_effectuee: true,
      });
      toast('Bilan enregistré, séance marquée effectuée', 'success');
      m.close();
      onSaved?.();
    } catch (e2) { err.append(errorBox(e2.message)); }
  });
}
