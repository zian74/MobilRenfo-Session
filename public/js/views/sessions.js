import { get, post, put, del } from '../api.js';
import { h, clear, field, input, select, textarea, errorBox, toast, confirmDialog, badge, emptyState, loading, modal, formatDuree } from '../ui.js';

const TYPES = [['renforcement', 'Renforcement'], ['mobilité', 'Mobilité'], ['mixte', 'Mixte']];

function itemTitle(it) {
  return it.exercise_nom || it.nom_libre || 'Bloc libre';
}

function itemParamsText(it) {
  const parts = [];
  const series = it.series ?? it.exercise_series_defaut;
  const reps = it.repetitions ?? it.exercise_repetitions_defaut;
  const temps = it.temps_travail ?? it.exercise_temps_travail_defaut;
  const repos = it.repos ?? it.exercise_repos_defaut;
  const charge = it.charge || it.exercise_charge_conseille || '';
  if (series) parts.push(`${series} séries`);
  if (reps) parts.push(`${reps} rép.`);
  if (temps) parts.push(`${temps} s`);
  if (repos) parts.push(`repos ${repos} s`);
  if (charge) parts.push(charge);
  return parts.join(' · ');
}

export async function renderSessions() {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(h('div', { class: 'page-title' },
    h('h1', {}, 'Fiches de session'),
    h('div', { class: 'page-actions' }, h('a', { class: 'btn primary', href: '#/sessions/nouvelle' }, '+ Nouvelle session'))));
  const list = h('div', { class: 'grid cols-2', id: 'sess-list' });
  main.append(list, loading());
  let data;
  try {
    data = await get('/api/sessions');
  } catch (e) {
    clear(list).append(h('div', { class: 'empty-state' }, e.message));
    return;
  }
  clear(list);
  if (data.sessions.length === 0) {
    list.append(emptyState('Aucune session pour le moment.', h('a', { class: 'btn primary', href: '#/sessions/nouvelle' }, '+ Composer une session')));
    return;
  }
  for (const s of data.sessions) {
    list.append(h('article', { class: 'card exercise-card' },
      h('h3', {}, s.nom),
      h('div', { class: 'meta' },
        badge(s.type === 'renforcement' ? 'Renforcement' : s.type === 'mobilité' ? 'Mobilité' : 'Mixte', s.type),
        badge(`${s.nb_exercices} exercice${s.nb_exercices > 1 ? 's' : ''}`),
        badge(formatDuree(s.duree_estimee))),
      s.description ? h('p', { class: 'small muted', style: 'margin:0' }, s.description) : null,
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn small primary', href: `#/sessions/${s.id}/demarrer` }, '▶ Démarrer'),
        h('a', { class: 'btn small', href: `#/sessions/${s.id}/lecture` }, '👁 Mode lecture'),
        h('a', { class: 'btn small', href: `#/sessions/${s.id}` }, 'Modifier'),
        h('button', { class: 'btn small', onclick: async () => {
          try {
            const copy = await post(`/api/sessions/${s.id}/duplicate`);
            toast('Session dupliquée', 'success');
            location.hash = `#/sessions/${copy.session.id}`;
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Dupliquer'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmDialog(`Supprimer la session « ${s.nom} » ?`)) {
            try { await del(`/api/sessions/${s.id}`); toast('Session supprimée', 'success'); renderSessions(); }
            catch (e) { toast(e.message, 'error'); }
          }
        } }, 'Supprimer'))));
  }
}

async function openExercisePicker(onPick) {
  const search = input('search', { placeholder: 'Rechercher un exercice…', 'aria-label': 'Rechercher un exercice' });
  const list = h('div', { class: 'picker-list' });
  const content = h('div', {}, search, list);
  const m = modal({ title: 'Ajouter un exercice', content, wide: true });
  async function load(q = '') {
    clear(list).append(loading());
    let data;
    try {
      data = await get(`/api/exercises?q=${encodeURIComponent(q)}&sort=nom`);
    } catch (e) {
      clear(list).append(h('div', { class: 'empty-state' }, e.message));
      return;
    }
    clear(list);
    if (!data.exercises.length) {
      list.append(emptyState('Aucun exercice correspondant. Créez-le depuis la bibliothèque « Exercices ».'));
      return;
    }
    for (const ex of data.exercises) {
      list.append(h('button', {
        class: 'picker-item',
        onclick: () => { onPick(ex); m.close(); },
      },
        h('div', {},
          h('div', { class: 'pi-name' }, ex.nom),
          h('div', { class: 'pi-meta' },
            `${ex.categorie} · ${ex.groupe_musculaire || '—'} · ${ex.niveau}${ex.series_defaut ? ` · ${ex.series_defaut}×${ex.repetitions_defaut ?? '…'}` : ''}`))));
    }
  }
  let deb;
  search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => load(search.value.trim()), 200); });
  search.focus();
  await load();
}

function itemEditor(it, index, onChange, onRemove) {
  const handle = h('button', { class: 'drag-handle', draggable: false, 'aria-label': `Déplacer ${itemTitle(it)}`, title: 'Glisser pour réordonner' }, '\u283f');
  const up = h('button', { class: 'btn small ghost', 'aria-label': 'Monter', onclick: () => onChange(index, null, 'up') }, '\u2191');
  const down = h('button', { class: 'btn small ghost', 'aria-label': 'Descendre', onclick: () => onChange(index, null, 'down') }, '\u2193');
  const remove = h('button', { class: 'btn small danger', 'aria-label': `Retirer ${itemTitle(it)}`, onclick: () => onRemove(index) }, '\u2715');
  const head = h('div', { class: 'si-head' },
    handle,
    h('h4', {}, `${index + 1}. ${itemTitle(it)}`),
    it.exercise_id ? badge(it.exercise_categorie === 'mobilité' ? 'Mobilité' : 'Renforcement', it.exercise_categorie) : badge('Bloc libre', 'mixte'),
    h('div', { style: 'margin-left:auto', class: 'row' }, up, down, remove));
  const wrap = (body) => h('div', {
    class: 'session-item',
    draggable: 'true',
    dataset: { index: String(index) },
    ondragstart: (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.classList.add('dragging');
    },
    ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    ondrop: (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(from) && from !== index) onChange(from, null, 'move', index);
    },
  }, head, body);
  const notes = input('text', { value: it.notes ?? '', placeholder: 'notes', maxlength: 1000 });
  notes.addEventListener('input', () => onChange(index, { ...it, notes: notes.value.trim() }));
  if (it.exercise_id) {
    return wrap(
      h('div', { class: 'ri-params' }, itemParamsText(it) || '\u2014'),
      field('Notes', notes));
  }
  const series = input('number', { min: 0, value: it.series ?? '', placeholder: 'séries' });
  const reps = input('number', { min: 0, value: it.repetitions ?? '', placeholder: 'rép.' });
  const temps = input('number', { min: 0, value: it.temps_travail ?? '', placeholder: 's' });
  const repos = input('number', { min: 0, value: it.repos ?? '', placeholder: 's' });
  const charge = input('text', { value: it.charge ?? '', placeholder: 'charge', maxlength: 60 });
  const read = () => {
    onChange(index, {
      ...it,
      series: series.value === '' ? null : Number(series.value),
      repetitions: reps.value === '' ? null : Number(reps.value),
      temps_travail: temps.value === '' ? null : Number(temps.value),
      repos: repos.value === '' ? null : Number(repos.value),
      charge: charge.value.trim(),
      notes: notes.value.trim(),
    });
  };
  for (const el of [series, reps, temps, repos, charge, notes]) el.addEventListener('input', read);
  return wrap(
    h('div', { class: 'field-row' },
      field('Séries', series), field('Répétitions', reps), field('Temps (s)', temps),
      field('Repos (s)', repos), field('Charge', charge)),
    field('Notes', notes));
}

export async function renderSessionForm(id) {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let session = null;
  if (id) {
    try {
      session = (await get(`/api/sessions/${id}`)).session;
    } catch (e) {
      clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
      return;
    }
  }
  clear(main);

  main.append(h('div', { class: 'page-title' },
    h('h1', {}, session ? `Modifier « ${session.nom} »` : 'Nouvelle session'),
    h('div', { class: 'page-actions' },
      session ? h('a', { class: 'btn', href: `#/sessions/${session.id}/lecture` }, '👁 Mode lecture') : null,
      h('a', { class: 'btn', href: '#/sessions' }, '← Retour'))));

  const nom = input('text', { required: true, maxlength: 120, value: session?.nom ?? '' });
  const description = textarea({ rows: 2 });
  description.value = session?.description ?? '';
  const type = select(TYPES, { value: session?.type ?? 'mixte' });
  const duree = input('number', { min: 0, max: 1440, value: session?.duree_estimee ?? '', placeholder: 'auto' });
  const echauffement = textarea({ rows: 2, placeholder: 'Bloc libre ou exercices d’échauffement' });
  echauffement.value = session?.echauffement ?? '';
  const retour = textarea({ rows: 2, placeholder: 'Bloc libre ou exercices de retour au calme' });
  retour.value = session?.retour_au_calme ?? '';

  let items = (session?.items ?? []).map((it) => ({ ...it }));
  const itemsBox = h('div', { id: 'items-box', style: 'display:flex;flex-direction:column;gap:10px' });

  function renderItems() {
    clear(itemsBox);
    if (!items.length) {
      itemsBox.append(h('div', { class: 'empty-state' }, 'Aucun exercice. Ajoutez-en depuis la bibliothèque.'));
      return;
    }
    items.forEach((it, i) => {
      itemsBox.append(itemEditor(it, i, (idx, patch, action, to) => {
        if (action === 'up' && idx > 0) { [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]]; renderItems(); }
        else if (action === 'down' && idx < items.length - 1) { [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]]; renderItems(); }
        else if (action === 'move') { const [moved] = items.splice(idx, 1); items.splice(to, 0, moved); renderItems(); }
        else if (patch) { items[idx] = patch; }
      }, (idx) => { items.splice(idx, 1); renderItems(); }));
    });
  }
  renderItems();

  const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => openExercisePicker((ex) => {
    items.push({
      exercise_id: ex.id,
      exercise_nom: ex.nom,
      exercise_categorie: ex.categorie,
      nom_libre: '',
      series: null,
      repetitions: null,
      temps_travail: null,
      repos: null,
      charge: '',
      notes: '',
    });
    renderItems();
  }) }, '＋ Ajouter un exercice');
  const addFree = h('button', { class: 'btn', type: 'button', onclick: () => {
    items.push({ exercise_id: null, nom_libre: 'Bloc libre', series: null, repetitions: null, temps_travail: null, repos: null, charge: '', notes: '' });
    renderItems();
  } }, '＋ Bloc libre');

  const err = h('div', {});
  const form = h('form', { class: 'card' });
  form.append(err,
    field('Nom de la session *', nom),
    field('Description', description),
    h('div', { class: 'field-row' }, field('Type', type), field('Durée estimée (min, vide = auto)', duree)),
    field('Échauffement (optionnel)', echauffement),
    field('Retour au calme (optionnel)', retour),
    h('h3', { class: 'mt' }, `Exercices (${items.length})`),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, addBtn, addFree),
    itemsBox,
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, session ? 'Enregistrer' : 'Créer la session'),
      h('a', { class: 'btn', href: '#/sessions' }, 'Annuler')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    const body = {
      nom: nom.value.trim(),
      description: description.value.trim(),
      type: type.value,
      duree_estimee: duree.value === '' ? null : Number(duree.value),
      echauffement: echauffement.value.trim(),
      retour_au_calme: retour.value.trim(),
      items: items.map((it) => ({
        exercise_id: it.exercise_id ?? null,
        nom_libre: it.nom_libre || '',
        series: it.series ?? null,
        repetitions: it.repetitions ?? null,
        temps_travail: it.temps_travail ?? null,
        repos: it.repos ?? null,
        charge: it.charge || '',
        notes: it.notes || '',
      })),
    };
    try {
      if (session) {
        await put(`/api/sessions/${session.id}`, body);
        toast('Session enregistrée', 'success');
      } else {
        await post('/api/sessions', body);
        toast('Session créée', 'success');
      }
      location.hash = '#/sessions';
    } catch (e2) {
      err.append(errorBox(e2.message));
    }
  });

  main.append(form);
  nom.focus();
}

export function buildReadSheet(session, { extraActions = null } = {}) {
  const sheet = h('div', { class: 'read-sheet card' });
  const checked = new Set();
  sheet.append(
    h('h1', {}, session.nom),
    h('div', { class: 'sheet-meta' },
      badge(session.type === 'renforcement' ? 'Renforcement' : session.type === 'mobilité' ? 'Mobilité' : 'Mixte', session.type),
      ' ',
      badge(formatDuree(session.duree_estimee)),
      session.description ? h('p', { class: 'muted', style: 'margin:8px 0 0' }, session.description) : null),
    h('div', { class: 'read-actions' },
      h('a', { class: 'btn primary', href: `#/sessions/${session.id}/demarrer` }, '▶ Démarrer la session'),
      h('a', { class: 'btn', href: `#/sessions/${session.id}` }, '← Modifier'),
      extraActions,
      h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Imprimer'),
      h('button', { class: 'btn', onclick: () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      } }, '⛶ Plein écran')));

  if (session.echauffement) {
    sheet.append(h('div', { class: 'read-block' }, h('strong', {}, 'Échauffement — '), session.echauffement));
  }
  const progressP = h('p', { class: 'muted small mt' }, `0/${session.items.length} exercices cochés`);
  session.items.forEach((it, i) => {
    const cb = input('checkbox', { 'aria-label': `Exercice ${i + 1} effectué` });
    const row = h('div', { class: 'read-item' });
    cb.addEventListener('change', () => {
      if (cb.checked) { checked.add(i); row.classList.add('checked'); }
      else { checked.delete(i); row.classList.remove('checked'); }
      progressP.textContent = `${checked.size}/${session.items.length} exercices cochés`;
    });
    row.append(cb, h('div', { class: 'ri-body' },
      h('div', { class: 'ri-name' }, `${i + 1}. ${itemTitle(it)}`),
      h('div', { class: 'ri-params' }, itemParamsText(it) || '—'),
      it.notes ? h('div', { class: 'ri-params' }, `Note : ${it.notes}`) : null,
      it.exercise_id && (it.exercise_groupe || it.exercise_niveau)
        ? h('div', { class: 'ri-params' }, [it.exercise_groupe, it.exercise_niveau].filter(Boolean).join(' · '))
        : null));
    sheet.append(row);
  });
  if (session.retour_au_calme) {
    sheet.append(h('div', { class: 'read-block' }, h('strong', {}, 'Retour au calme — '), session.retour_au_calme));
  }
  sheet.append(progressP);
  return sheet;
}

export async function renderSessionRead(id) {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let session;
  try {
    session = (await get(`/api/sessions/${id}`)).session;
  } catch (e) {
    clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
    return;
  }
  clear(main);
  main.append(buildReadSheet(session));
}
