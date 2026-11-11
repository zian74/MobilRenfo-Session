import { get, put, post, del } from '../api.js';
import { h, clear, field, input, toast, confirmDialog, errorBox, loading } from '../ui.js';
import { state } from '../main.js';

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

  const email = input('email', { value: me.email, disabled: true });
  const name = input('text', { value: me.name, maxlength: 100 });
  const niveau = h('select', {}, ...NIVEAUX.map((n) => h('option', { value: n, selected: n === me.niveau }, n)));
  const objBox = h('div', { role: 'group', 'aria-label': 'Objectifs' });
  const checks = OBJECTIFS.map((o) => {
    const cb = input('checkbox', { checked: me.objectifs.includes(o) });
    objBox.append(h('label', { class: 'checkbox-field' }, cb, o));
    return { o, cb };
  });

  const err = h('div', {});
  const form = h('form', { class: 'card' });
  form.append(err,
    field('Email', email, { hint: 'L’email ne peut pas être modifié.' }),
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
  actions.append(h('h2', { style: 'font-size:1.05rem;margin-top:0' }, 'Compte & données'));
  const row = h('div', { class: 'form-actions' });
  row.append(
    h('a', { class: 'btn', href: '/api/auth/me/export', download: 'mobilrenfo-export.json' }, '⬇ Exporter mes données (RGPD)'),
    h('button', { class: 'btn', onclick: async () => {
      try { await post('/api/auth/logout'); } catch { /* ignore */ }
      state.user = null;
      toast('Déconnecté', 'success');
      location.hash = '#/connexion';
    } }, 'Se déconnecter'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (await confirmDialog('Supprimer définitivement votre compte et toutes vos données (exercices, sessions, planning, historique) ? Cette action est irréversible.', { confirmLabel: 'Supprimer mon compte' })) {
        try {
          await del('/api/auth/me');
          state.user = null;
          toast('Compte supprimé', 'success');
          location.hash = '#/inscription';
        } catch (e) { toast(e.message, 'error'); }
      }
    } }, 'Supprimer mon compte'));
  actions.append(row);
  main.append(actions);
}
