import { post } from '../api.js';
import { h, clear, field, input, errorBox, toast } from '../ui.js';
import { state } from '../main.js';

const NIVEAUX = ['débutant', 'intermédiaire', 'avancé'];
const OBJECTIFS = ['perte de poids', 'prise de masse', 'mobilité', 'performance'];

export async function renderAuth(mode) {
  const main = document.getElementById('app-main');
  clear(main);
  const isLogin = mode === 'login';

  const email = input('email', { required: true, autocomplete: 'email', placeholder: 'vous@exemple.fr' });
  const password = input('password', {
    required: true,
    minlength: 8,
    autocomplete: isLogin ? 'current-password' : 'new-password',
    placeholder: isLogin ? 'Votre mot de passe' : '8 caractères minimum',
  });
  const name = input('text', { autocomplete: 'name', placeholder: 'Prénom ou pseudo (optionnel)' });
  const niveau = h('select', { id: 'auth-niveau' }, ...NIVEAUX.map((n) => h('option', { value: n }, n)));
  const objectifsBox = h('div', { role: 'group', 'aria-label': 'Objectifs' });
  const objChecks = OBJECTIFS.map((o) => {
    const cb = input('checkbox', {});
    return { o, cb, row: h('label', { class: 'checkbox-field' }, cb, o) };
  });
  objChecks.forEach(({ row }) => objectifsBox.append(row));

  const form = h('form', { novalidate: false });
  const err = h('div', {});
  form.append(err);
  form.append(field('Email', email));
  form.append(field('Mot de passe', password));
  if (!isLogin) {
    form.append(field('Nom', name));
    form.append(field('Niveau', niveau));
    const f = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Objectifs'), objectifsBox);
    form.append(f);
  }
  const submit = h('button', { type: 'submit', class: 'btn primary' }, isLogin ? 'Se connecter' : "S'inscrire");
  form.append(h('div', { class: 'form-actions' }, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    submit.disabled = true;
    try {
      const body = isLogin
        ? { email: email.value.trim(), password: password.value }
        : {
            email: email.value.trim(),
            password: password.value,
            name: name.value.trim(),
            niveau: niveau.value,
            objectifs: objChecks.filter(({ cb }) => cb.checked).map(({ o }) => o),
          };
      const { user } = await post(isLogin ? '/api/auth/login' : '/api/auth/register', body);
      state.user = user;
      toast(isLogin ? `Bienvenue ${user.name || user.email}` : 'Compte créé, bienvenue !', 'success');
      location.hash = '#/calendrier';
    } catch (e2) {
      err.append(errorBox(e2.message));
      submit.disabled = false;
    }
  });

  const wrap = h('div', { class: 'auth-wrap' },
    h('div', { class: 'card' },
      h('h1', {}, isLogin ? 'Connexion' : 'Créer un compte'),
      h('p', { class: 'muted small' }, isLogin
        ? 'Accédez à vos exercices, sessions et planning.'
        : 'Vos données restent privées et vous pouvez les exporter ou les supprimer à tout moment.'),
      form));
  const switchLink = isLogin
    ? h('p', { class: 'auth-switch' }, 'Pas encore de compte ? ', h('a', { href: '#/inscription' }, "S'inscrire"))
    : h('p', { class: 'auth-switch' }, 'Déjà un compte ? ', h('a', { href: '#/connexion' }, 'Se connecter'));
  wrap.append(switchLink);
  main.append(wrap);
  email.focus();
}
