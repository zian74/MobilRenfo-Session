import { get, post, put, del, uploadMedia } from '../api.js';
import { h, clear, field, input, select, textarea, errorBox, toast, confirmDialog, badge, emptyState, loading, mediaPreview, mediaKey } from '../ui.js';

const CATEGORIES = [['renforcement', 'Renforcement'], ['mobilité', 'Mobilité']];
const NIVEAUX = [['débutant', 'Débutant'], ['intermédiaire', 'Intermédiaire'], ['avancé', 'Avancé']];
const SORTS = [['recent', 'Modifiés récemment'], ['nom', 'Nom A → Z'], ['ancien', 'Plus anciens'], ['favori', 'Favoris d’abord']];

function paramsLabel(ex) {
  const parts = [];
  if (ex.series_defaut) parts.push(`${ex.series_defaut} séries`);
  if (ex.repetitions_defaut) parts.push(`${ex.repetitions_defaut} rép.`);
  if (ex.temps_travail_defaut) parts.push(`${ex.temps_travail_defaut} s`);
  if (ex.repos_defaut) parts.push(`repos ${ex.repos_defaut} s`);
  if (ex.charge_conseille) parts.push(`charge : ${ex.charge_conseille}`);
  return parts.join(' · ') || 'Paramètres par défaut non définis';
}

export async function renderExercises() {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(h('div', { class: 'page-title' },
    h('h1', {}, 'Bibliothèque d’exercices'),
    h('div', { class: 'page-actions' }, h('a', { class: 'btn primary', href: '#/exercices/nouveau' }, '+ Nouvel exercice'))));

  const q = input('search', { placeholder: 'Rechercher (nom, tag, description)…', 'aria-label': 'Recherche plein texte' });
  const cat = select([['', 'Toutes catégories'], ...CATEGORIES]);
  const groupe = select([['', 'Tous groupes']]);
  const equip = select([['', 'Tout équipement']]);
  const niv = select([['', 'Tous niveaux'], ...NIVEAUX]);
  const fav = select([['', 'Tous'], ['1', 'Favoris uniquement']]);
  const sort = select(SORTS, { value: 'recent' });

  const toolbar = h('div', { class: 'toolbar card' },
    h('div', { class: 'field', style: 'flex:1 1 220px' }, h('label', { class: 'label', for: q.id = 'q' }, 'Recherche'), q),
    field('Catégorie', cat), field('Groupe musculaire', groupe), field('Équipement', equip),
    field('Niveau', niv), field('Favoris', fav), field('Tri', sort));
  main.append(toolbar);

  const list = h('div', { class: 'grid cols-3', id: 'ex-list' });
  main.append(list);

  let facets = { groupes: [], equipements: [] };
  try { facets = await get('/api/exercises/facets'); } catch { /* facettes optionnelles */ }
  for (const g of facets.groupes) groupe.append(h('option', { value: g }, g));
  for (const e of facets.equipements) equip.append(h('option', { value: e }, e));

  async function load() {
    clear(list).append(loading());
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set('q', q.value.trim());
    if (cat.value) qs.set('categorie', cat.value);
    if (groupe.value) qs.set('groupe', groupe.value);
    if (equip.value) qs.set('equipement', equip.value);
    if (niv.value) qs.set('niveau', niv.value);
    if (fav.value) qs.set('favori', fav.value);
    if (sort.value) qs.set('sort', sort.value);
    let data;
    try {
      data = await get(`/api/exercises?${qs}`);
    } catch (e) {
      clear(list).append(h('div', { class: 'empty-state' }, e.message));
      return;
    }
    clear(list);
    if (data.exercises.length === 0) {
      list.append(emptyState('Aucun exercice trouvé.', h('a', { class: 'btn primary', href: '#/exercices/nouveau' }, '+ Créer un exercice')));
      return;
    }
    for (const ex of data.exercises) {
      const star = h('button', {
        class: 'star-btn',
        'aria-pressed': String(ex.favori),
        'aria-label': ex.favori ? 'Retirer des favoris' : 'Ajouter aux favoris',
        title: 'Favori',
        onclick: async () => {
          try {
            await post(`/api/exercises/${ex.id}/favori`, { favori: !ex.favori });
            load();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, ex.favori ? '★' : '☆');
      const card = h('article', { class: 'card exercise-card' },
        h('div', { class: 'row' }, h('h3', {}, ex.nom), h('div', { style: 'margin-left:auto' }, star)),
        h('div', { class: 'meta' },
          badge(ex.categorie === 'renforcement' ? 'Renforcement' : 'Mobilité', ex.categorie),
          badge(ex.niveau),
          ex.groupe_musculaire ? badge(ex.groupe_musculaire) : null),
        ex.media_url ? mediaPreview(ex.media_url, { small: true }) : null,
        h('div', { class: 'meta' }, ...ex.equipement.map((e) => badge(e))),
        h('p', { class: 'small muted', style: 'margin:0' }, paramsLabel(ex)),
        ex.tags.length ? h('div', { class: 'tag-list' }, ...ex.tags.map((t) => h('span', { class: 'tag' }, t))) : null,
        h('div', { class: 'card-actions' },
          h('a', { class: 'btn small', href: `#/exercices/${ex.id}` }, 'Modifier'),
          h('button', { class: 'btn small', onclick: async () => {
            try {
              const copy = await post(`/api/exercises/${ex.id}/duplicate`);
              toast('Exercice dupliqué', 'success');
              location.hash = `#/exercices/${copy.exercise.id}`;
            } catch (e) { toast(e.message, 'error'); }
          } }, 'Dupliquer'),
          h('button', { class: 'btn small danger', onclick: async () => {
            if (await confirmDialog(`Supprimer « ${ex.nom} » ? Cette action est définitive.`)) {
              try { await del(`/api/exercises/${ex.id}`); toast('Exercice supprimé', 'success'); load(); }
              catch (e) { toast(e.message, 'error'); }
            }
          } }, 'Supprimer')));
      list.append(card);
    }
  }

  let debounce;
  q.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(load, 200); });
  for (const el of [cat, groupe, equip, niv, fav, sort]) el.addEventListener('change', load);
  await load();
}

export async function renderExerciseForm(id) {
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let ex = null;
  if (id) {
    try {
      ex = (await get(`/api/exercises/${id}`)).exercise;
    } catch (e) {
      clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
      return;
    }
  }
  clear(main);

  main.append(h('div', { class: 'page-title' },
    h('h1', {}, ex ? `Modifier « ${ex.nom} »` : 'Nouvel exercice'),
    h('div', { class: 'page-actions' },
      ex ? h('a', { class: 'btn primary', href: `#/exercices/${ex.id}/demarrer` }, '▶ Démarrer l’exercice') : null,
      h('a', { class: 'btn', href: '#/exercices' }, '← Retour'))));

  const nom = input('text', { required: true, maxlength: 120, value: ex?.nom ?? '' });
  const categorie = select(CATEGORIES, { value: ex?.categorie ?? 'renforcement' });
  const groupe = input('text', { maxlength: 80, list: 'groupes-list', value: ex?.groupe_musculaire ?? '', placeholder: 'ex. pectoraux, chaîne postérieure, hanches' });
  const datalist = h('datalist', { id: 'groupes-list' });
  try {
    const facets = await get('/api/exercises/facets');
    for (const g of facets.groupes) datalist.append(h('option', { value: g }));
    for (const e of facets.equipements) datalist.append(h('option', { value: e }));
  } catch { /* ignore */ }
  const niveau = select(NIVEAUX, { value: ex?.niveau ?? 'débutant' });
  const equipement = input('text', { value: (ex?.equipement ?? []).join(', '), placeholder: 'Séparés par des virgules : haltères, élastique…', list: 'groupes-list' });
  const description = textarea({ rows: 5, placeholder: 'Étapes de réalisation, points d’attention…' });
  description.value = ex?.description ?? '';
  const media = input('url', { value: ex?.media_url ?? '', placeholder: 'https://… (image ou vidéo, optionnel)' });
  const fileInput = input('file', { accept: 'image/*,video/*' });
  const previewBox = h('div', { class: 'media-box' });
  function refreshPreview() {
    clear(previewBox);
    const url = media.value.trim();
    if (!url) return;
    const prev = mediaPreview(url);
    if (prev) previewBox.append(prev);
    const key = mediaKey(url);
    if (key) {
      previewBox.append(h('button', {
        class: 'btn small danger', type: 'button',
        onclick: async () => {
          try { await del(`/api/media/${key}`); } catch { /* ignore */ }
          media.value = '';
          refreshPreview();
          toast('Média uploadé supprimé', 'success');
        },
      }, 'Supprimer le média uploadé'));
    }
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    fileInput.disabled = true;
    try {
      const up = await uploadMedia(f);
      media.value = up.url;
      refreshPreview();
      toast(`Média uploadé (${Math.round(up.size / 1024)} Ko)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { fileInput.disabled = false; fileInput.value = ''; }
  });
  media.addEventListener('input', refreshPreview);
  refreshPreview();
  const series = input('number', { min: 0, max: 1000, value: ex?.series_defaut ?? '' });
  const reps = input('number', { min: 0, max: 10000, value: ex?.repetitions_defaut ?? '' });
  const temps = input('number', { min: 0, placeholder: 'secondes', value: ex?.temps_travail_defaut ?? '' });
  const repos = input('number', { min: 0, placeholder: 'secondes', value: ex?.repos_defaut ?? '' });
  const charge = input('text', { maxlength: 60, value: ex?.charge_conseille ?? '', placeholder: 'ex. 20 kg, élastique fort' });
  const tags = input('text', { value: (ex?.tags ?? []).join(', '), placeholder: 'Séparés par des virgules' });
  const favori = input('checkbox', {});
  favori.checked = !!ex?.favori;

  const err = h('div', {});
  const form = h('form', { class: 'card' });
  form.append(err,
    field('Nom de l’exercice *', nom),
    h('div', { class: 'field-row' }, field('Catégorie', categorie), field('Niveau', niveau), field('Groupe musculaire', groupe)),
    field('Équipement', equipement, { hint: 'Valeurs séparées par des virgules' }),
    field('Description des étapes', description),
    field('Média (URL image/vidéo)', media),
    field('…ou uploader un fichier (image/vidéo, 25 Mo max)', fileInput),
    previewBox,
    h('h3', { class: 'mt' }, 'Paramètres par défaut'),
    h('div', { class: 'field-row' },
      field('Séries', series), field('Répétitions', reps), field('Temps de travail (s)', temps),
      field('Repos (s)', repos), field('Charge conseillée', charge)),
    field('Tags', tags, { hint: 'Mots-clés séparés par des virgules, pour la recherche' }),
    h('label', { class: 'checkbox-field' }, favori, '⭐ Exercice favori'),
    datalist,
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, ex ? 'Enregistrer' : 'Créer l’exercice'),
      h('a', { class: 'btn', href: '#/exercices' }, 'Annuler')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    const parseList = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
    const toInt = (v) => (v === '' ? null : Number(v));
    const body = {
      nom: nom.value.trim(),
      categorie: categorie.value,
      groupe_musculaire: groupe.value.trim(),
      niveau: niveau.value,
      equipement: parseList(equipement.value),
      description: description.value.trim(),
      media_url: media.value.trim(),
      series_defaut: toInt(series.value),
      repetitions_defaut: toInt(reps.value),
      temps_travail_defaut: toInt(temps.value),
      repos_defaut: toInt(repos.value),
      charge_conseille: charge.value.trim(),
      tags: parseList(tags.value),
      favori: favori.checked,
    };
    try {
      if (ex) {
        await put(`/api/exercises/${ex.id}`, body);
        toast('Exercice enregistré', 'success');
      } else {
        await post('/api/exercises', body);
        toast('Exercice créé', 'success');
      }
      location.hash = '#/exercices';
    } catch (e2) {
      err.append(errorBox(e2.message));
    }
  });

  main.append(form);
  nom.focus();
}
