import { get, post, put, del } from '../api.js';
import { h, clear, field, input, select, textarea, errorBox, toast, confirmDialog, modal, loading, formatDateFr, joursPicker } from '../ui.js';
import { openLogModal } from './logModal.js';

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const RECURRENCES = [['none', 'Une seule fois'], ['daily', 'Tous les jours'], ['weekly', 'Toutes les semaines'], ['custom', 'Jours personnalisés…']];
const TYPE_LABEL = { renforcement: 'Renforcement', mobilité: 'Mobilité', mixte: 'Mixte', libre: 'Libre' };

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function mondayOf(d) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - dow);
  return copy;
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export async function renderCalendar() {
  const main = document.getElementById('app-main');
  clear(main);

  let mode = 'semaine';
  let anchor = new Date();
  anchor.setHours(0, 0, 0, 0);

  main.append(h('div', { class: 'page-title' }, h('h1', {}, 'Calendrier')));

  const title = h('span', { class: 'cal-title' });
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Vue du calendrier' },
    h('button', { role: 'tab', class: 'active', 'aria-selected': 'true', onclick: () => setMode('semaine') }, 'Semaine'),
    h('button', { role: 'tab', class: '', 'aria-selected': 'false', onclick: () => setMode('mois') }, 'Mois'));
  const prev = h('button', { class: 'btn small', 'aria-label': 'Période précédente', onclick: () => shift(-1) }, '‹');
  const next = h('button', { class: 'btn small', 'aria-label': 'Période suivante', onclick: () => shift(1) }, '›');
  const todayBtn = h('button', { class: 'btn small', onclick: () => { anchor = new Date(); anchor.setHours(0, 0, 0, 0); load(); } }, 'Aujourd’hui');
  const toolbar = h('div', { class: 'cal-toolbar card' }, prev, todayBtn, next, title, seg);
  main.append(toolbar);

  const gridWrap = h('div', {});
  main.append(gridWrap);

  function setMode(m) {
    mode = m;
    [...seg.querySelectorAll('button')].forEach((b, i) => {
      const active = (i === 0) === (m === 'semaine');
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    load();
  }
  function shift(dir) {
    if (mode === 'semaine') anchor = addDays(anchor, 7 * dir);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    load();
  }

  function range() {
    if (mode === 'semaine') {
      const start = mondayOf(anchor);
      return { from: iso(start), to: iso(addDays(start, 6)), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = mondayOf(first);
    const end = addDays(start, 41);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return { from: iso(start), to: iso(end), days };
  }

  async function load() {
    const r = range();
    if (mode === 'semaine') {
      title.textContent = `${formatDateFr(r.from)} → ${formatDateFr(r.to)}`;
    } else {
      title.textContent = anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }
    clear(gridWrap).append(loading());
    let planned = [];
    try {
      planned = (await get(`/api/planned?from=${r.from}&to=${r.to}`)).planned;
    } catch (e) {
      clear(gridWrap).append(h('div', { class: 'empty-state' }, e.message));
      return;
    }
    const byDate = new Map();
    for (const p of planned) {
      if (!byDate.has(p.occurrenceDate)) byDate.set(p.occurrenceDate, []);
      byDate.get(p.occurrenceDate).push(p);
    }
    const todayIso = iso(new Date());
    clear(gridWrap);
    const grid = h('div', { class: `cal-grid ${mode === 'mois' ? 'cal-month' : ''}`, role: 'grid' });
    for (const j of JOURS) grid.append(h('div', { class: 'cal-head', role: 'columnheader' }, j));
    for (const day of r.days) {
      const dIso = iso(day);
      const inMonth = mode === 'semaine' || day.getMonth() === anchor.getMonth();
      const cell = h('div', {
        class: `cal-day ${dIso === todayIso ? 'today' : ''} ${inMonth ? '' : 'out'}`,
        role: 'gridcell',
        tabindex: '0',
        'aria-label': `${formatDateFr(dIso)}, ${mode === 'semaine' ? 'cliquer pour planifier' : ''}`,
        onclick: (e) => { if (e.target === cell || e.target.classList.contains('day-num')) openPlanModal(dIso); },
        onkeydown: (e) => { if (e.key === 'Enter' && e.target === cell) openPlanModal(dIso); },
        ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drag-over'); },
        ondragleave: () => cell.classList.remove('drag-over'),
        ondrop: async (e) => {
          e.preventDefault();
          cell.classList.remove('drag-over');
          const payload = e.dataTransfer.getData('text/plain');
          if (!payload) return;
          try {
            const { id } = JSON.parse(payload);
            await put(`/api/planned/${id}`, { date: dIso });
            toast(`Séance déplacée au ${formatDateFr(dIso)}`, 'success');
            load();
          } catch (e2) { toast(e2.message, 'error'); }
        },
      }, h('span', { class: 'day-num' }, String(day.getDate())));
      for (const p of byDate.get(dIso) ?? []) {
        const chip = h('button', {
          class: `cal-item ${p.effectuee ? 'done' : ''} ${p.recurrence !== 'none' ? 'rec' : ''}`,
          style: `background:${p.couleur}`,
          draggable: 'true',
          title: `${TYPE_LABEL[p.session_type] ?? p.session_type}${p.recurrence !== 'none' ? ' · récurrente' : ''}${p.effectuee ? ' · effectuée' : ''}`,
          onclick: (e) => { e.stopPropagation(); openDetailModal(p); },
          ondragstart: (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', JSON.stringify({ id: p.id }));
            e.dataTransfer.effectAllowed = 'move';
          },
        }, p.heure ? h('span', { class: 'heure' }, p.heure) : null, p.session_nom || p.titre_libre || 'Séance');
        cell.append(chip);
      }
      grid.append(cell);
    }
    gridWrap.append(grid);
  }

  function recurrenceFields(initialRec = 'none', initialJours = [], initialFin = '') {
    const rec = select(RECURRENCES, { value: initialRec });
    const picker = joursPicker(initialJours);
    const fin = input('date', { value: initialFin || '' });
    const customBox = h('div', { class: 'field', style: 'display:none' },
      h('span', { class: 'label' }, 'Jours concernés'),
      picker.box,
      field('Fin de récurrence (optionnel)', fin));
    const toggle = () => { customBox.style.display = rec.value === 'custom' ? '' : 'none'; };
    rec.addEventListener('change', toggle);
    toggle();
    return {
      rec, fin, customBox,
      get: () => ({
        recurrence: rec.value,
        jours: rec.value === 'custom' ? picker.get() : [],
        fin_recurrence: fin.value || null,
      }),
    };
  }

  function rappelFields(initial) {
    const init = initial || { actif: false, minutes: 15 };
    const cb = input('checkbox', { checked: !!init.actif });
    const mins = input('number', { min: 0, max: 1440, value: init.minutes ?? 15, style: 'width:90px' });
    const box = h('div', { class: 'field-row' },
      h('label', { class: 'checkbox-field', style: 'margin:0' }, cb, '🔔 Rappel avant la séance'),
      field('Minutes avant', mins));
    return { box, get: () => ({ actif: cb.checked, minutes: mins.value === '' ? 15 : Number(mins.value) }) };
  }

  async function openPlanModal(dateIso) {
    let sessions = [];
    try { sessions = (await get('/api/sessions')).sessions; } catch { /* ignore */ }
    const sessionSel = select([['', '— Séance libre —'], ...sessions.map((s) => [String(s.id), `${s.nom} (${TYPE_LABEL[s.type]})`])]);
    const titre = input('text', { maxlength: 120, placeholder: 'ex. Étirements du soir' });
    const heure = input('time', {});
    const recF = recurrenceFields();
    const rapF = rappelFields();
    const notes = textarea({ rows: 2, placeholder: 'Notes (optionnel)' });
    const err = h('div', {});
    const content = h('form', {}, err,
      h('p', { class: 'muted small' }, `Planifier le ${formatDateFr(dateIso)}`),
      field('Fiche de session', sessionSel),
      field('Titre (si séance libre)', titre),
      h('div', { class: 'field-row' }, field('Heure (optionnel)', heure), field('Récurrence', recF.rec)),
      recF.customBox,
      rapF.box,
      field('Notes', notes),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Planifier'),
        h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Annuler')));
    const m = modal({ title: 'Planifier une séance', content });
    content.addEventListener('submit', async (e) => {
      e.preventDefault();
      clear(err);
      const sid = sessionSel.value === '' ? null : Number(sessionSel.value);
      if (sid === null && !titre.value.trim()) {
        err.append(errorBox('Choisissez une fiche de session ou saisissez un titre de séance libre.'));
        return;
      }
      try {
        await post('/api/planned', {
          session_id: sid,
          titre_libre: titre.value.trim(),
          date: dateIso,
          heure: heure.value || null,
          ...recF.get(),
          rappel: rapF.get(),
          notes: notes.value.trim(),
        });
        toast('Séance planifiée', 'success');
        m.close();
        load();
      } catch (e2) { err.append(errorBox(e2.message)); }
    });
  }

  async function openDetailModal(p) {
    let session = null;
    if (p.session_id) {
      try { session = (await get(`/api/sessions/${p.session_id}`)).session; } catch { session = null; }
    }
    const heure = input('time', { value: p.heure ?? '' });
    const recF = recurrenceFields(p.recurrence, p.jours ?? [], p.fin_recurrence ?? '');
    const rapF = rappelFields(p.rappel);
    const notes = textarea({ rows: 2 });
    notes.value = p.notes ?? '';
    const date = input('date', { value: p.date });
    const err = h('div', {});

    const content = h('div', {},
      h('p', {}, h('strong', {}, p.session_nom || p.titre_libre || 'Séance libre'), ' — ', formatDateFr(p.occurrenceDate),
        p.recurrence !== 'none' ? ` · ${RECURRENCES.find(([v]) => v === p.recurrence)[1].toLowerCase()}` : ''),
      err,
      h('div', { class: 'field-row' },
        field('Jour', date), field('Heure', heure), field('Récurrence', recF.rec)),
      recF.customBox,
      rapF.box,
      field('Notes', notes));

    const btnRow = h('div', { class: 'form-actions' });
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      clear(err);
      try {
        await put(`/api/planned/${p.id}`, { date: date.value, heure: heure.value || null, ...recF.get(), rappel: rapF.get(), notes: notes.value.trim() });
        toast('Planification mise à jour', 'success');
        m.close();
        load();
      } catch (e) { err.append(errorBox(e.message)); }
    } }, 'Enregistrer');
    const doneBtn = h('button', { class: `btn ${p.effectuee ? '' : 'primary'}`, onclick: () => openLogModal(p, session, { onSaved: load }) }, p.effectuee ? '📋 Voir / modifier le bilan' : '✅ Marquer effectuée + bilan');
    const readBtn = session ? h('a', { class: 'btn', href: `#/seance/${p.id}`, onclick: () => m.close() }, '▶ Séance du jour') : null;
    const delBtn = h('button', { class: 'btn danger', onclick: async () => {
      if (await confirmDialog('Supprimer cette planification (et son bilan) ?')) {
        try { await del(`/api/planned/${p.id}`); toast('Planification supprimée'); m.close(); load(); }
        catch (e) { err.append(errorBox(e.message)); }
      }
    } }, 'Supprimer');
    btnRow.append(saveBtn, doneBtn, readBtn, delBtn, h('button', { class: 'btn', onclick: () => m.close() }, 'Fermer'));
    content.append(btnRow);
    const m = modal({ title: 'Séance planifiée', content });
  }

  await load();
}
