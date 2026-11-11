import { get, put, del, exportData, importData } from '../api.js';
import { h, clear, field, input, toast, confirmDialog, errorBox, loading } from '../ui.js';
import { state } from '../main.js';
import { requestNotificationPermission } from '../notifications.js';

const NIVEAUX = ['débutant', 'intermédiaire', 'avancé'];
const OBJECTIFS = ['perte de poids', 'prise de masse', 'mobilité', 'performance'];

export async function renderProfile() {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let me;
  try {
    me = (await get('/api/auth/me')).user;
  } catch (e) {
    clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
    return;
  }
  clear(main);
  state.user = me;

  main.append(h('div', { class: 'page-title' }, h('h1', {}, 'Mon profil')));

  const name = input('text', { value: me.name, maxlength: 100, placeholder: 'Votre prénom ou pseudo' });
  const niveau = h('select', {}, ...NIVEAUX.map((n) => h('option', { value: n, selected: n === me.niveau }, n)));
  const objBox = h('div', { role: 'group', 'aria-label': 'Objectifs' });
  const checks = OBJECTIFS.map((o) => {
    const cb = input('checkbox', { checked: (me.objectifs || []).includes(o) });
    objBox.append(h('label', { class: 'checkbox-field' }, cb, o));
    return { o, cb };
  });

  const err = h('div', {});
  const form = h('form', { class: 'card' });
  form.append(err,
    h('p', { class: 'muted small' }, 'Version 100 % locale et mono-utilisateur : vos données restent dans ce navigateur (localStorage + IndexedDB), aucune compte, aucun serveur.'),
    field('Nom', name),
    field('Niveau', niveau),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Objectifs'), objBox),
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, 'Enregistrer')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    try {
      const { user } = await put('/api/auth/me', {
        name: name.value.trim(),
        niveau: niveau.value,
        objectifs: checks.filter(({ cb }) => cb.checked).map(({ o }) => o),
      });
      state.user = user;
      toast('Profil mis à jour', 'success');
    } catch (e2) { err.append(errorBox(e2.message)); }
  });
  main.append(form);

  const actions = h('div', { class: 'card mt' });
  actions.append(h('h2', { style: 'font-size:1.05rem;margin-top:0' }, 'Mes données (100 % locales)'));
  const row = h('div', { class: 'form-actions' });
  const importInput = input('file', { accept: 'application/json,.json', style: 'display:none' });
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const res = importData(obj);
      toast(`Import réussi : ${res.counts.exercises} exercices, ${res.counts.sessions} sessions, ${res.counts.planned} planifications`, 'success');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast(e.message || 'Fichier invalide', 'error');
    }
    importInput.value = '';
  });
  row.append(
    h('button', { class: 'btn', onclick: () => importInput.click() }, '⬆ Importer des données (JSON)'),
    h('button', { class: 'btn', onclick: async () => {
      const perm = await requestNotificationPermission();
      toast(perm === 'granted' ? '🔔 Notifications activées (rappels de séances)' : perm === 'unsupported' ? 'Notifications non supportées par ce navigateur' : 'Notifications refusées', perm === 'granted' ? 'success' : '');
    } }, '🔔 Activer les rappels de séance'),
    h('button', { class: 'btn', onclick: async () => {
      try {
        const data = await exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: 'mobilrenfo-export.json' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('Export JSON téléchargé', 'success');
      } catch (e) { toast(e.message, 'error'); }
    } }, '⬇ Exporter mes données (JSON)'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (await confirmDialog('Effacer définitivement toutes les données locales (exercices, sessions, planning, historique, médias) ?', { confirmLabel: 'Tout effacer' })) {
        try {
          await del('/api/auth/me');
          toast('Données effacées', 'success');
          setTimeout(() => location.reload(), 600);
        } catch (e) { toast(e.message, 'error'); }
      }
    } }, '🗑 Effacer toutes mes données'));
  actions.append(row, importInput);
  main.append(actions);
}
