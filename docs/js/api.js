import { loadJSON, saveJSON, removeKey } from './storage.js';
import { idbPut, idbGet, idbDelete, idbClear } from './mediaStore.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATA_KEY = 'mrs-data-v1';
const CATEGORIES = ['renforcement', 'mobilité'];
const NIVEAUX = ['débutant', 'intermédiaire', 'avancé'];
const TYPES = ['renforcement', 'mobilité', 'mixte'];
const RECURRENCES = ['none', 'daily', 'weekly', 'custom'];
const TYPE_COLORS = { renforcement: '#e05252', mobilité: '#3d9970', mixte: '#3b6fd4', libre: '#8a8f98' };
const ALLOWED_MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const MAX_MEDIA_SIZE = 25 * 1024 * 1024;

function emptyData() {
  return {
    profile: { name: '', niveau: 'débutant', objectifs: [], createdAt: new Date().toISOString() },
    exercises: [],
    sessions: [],
    planned: [],
    seq: { exercise: 1, session: 1, item: 1, planned: 1, log: 1 },
  };
}

let data = loadJSON(DATA_KEY, null) || emptyData();

function persist() {
  saveJSON(DATA_KEY, data);
}

function nextId(kind) {
  const id = data.seq[kind];
  data.seq[kind] = id + 1;
  return id;
}

function str(v, { max = 500, required = false, fallback = '' } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new ApiError(400, 'Champ requis manquant');
    return fallback;
  }
  const s = String(v).trim();
  if (required && !s) throw new ApiError(400, 'Champ requis vide');
  if (s.length > max) throw new ApiError(400, 'Champ trop long');
  return s;
}

function intOrNull(v, { min = -1000000, max = 1000000 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, 'Valeur entière invalide');
  return n;
}

function oneOf(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function strArray(v, { maxItems = 30, maxLen = 60 } = {}) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((x) => String(x ?? '').trim().slice(0, maxLen)).filter(Boolean);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function estimatedDuration(items) {
  let total = 0;
  for (const it of items) {
    const series = it.series || 0;
    const reps = it.repetitions || 0;
    const temps = it.temps_travail || 0;
    const repos = it.repos || 0;
    if (series > 0 && (reps > 0 || temps > 0)) {
      total += series * (temps > 0 ? temps : reps * 3) + Math.max(0, series - 1) * repos;
    } else if (temps > 0) total += temps;
  }
  return Math.round(total / 60);
}

function parseExerciseInput(body) {
  return {
    nom: str(body?.nom, { max: 120, required: true }),
    categorie: oneOf(str(body?.categorie, { max: 30 }), CATEGORIES, 'renforcement'),
    groupe_musculaire: str(body?.groupe_musculaire, { max: 80 }),
    niveau: oneOf(str(body?.niveau, { max: 30 }), NIVEAUX, 'débutant'),
    equipement: strArray(body?.equipement, { maxItems: 20, maxLen: 40 }),
    description: str(body?.description, { max: 4000 }),
    media_url: str(body?.media_url, { max: 500 }),
    series_defaut: intOrNull(body?.series_defaut, { min: 0, max: 1000 }),
    repetitions_defaut: intOrNull(body?.repetitions_defaut, { min: 0, max: 10000 }),
    temps_travail_defaut: intOrNull(body?.temps_travail_defaut, { min: 0, max: 36000 }),
    repos_defaut: intOrNull(body?.repos_defaut, { min: 0, max: 36000 }),
    charge_conseille: str(body?.charge_conseille, { max: 60 }),
    tags: strArray(body?.tags, { maxItems: 20, maxLen: 40 }),
    favori: body?.favori ? true : false,
  };
}

function parseSessionInput(body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
  return {
    nom: str(body?.nom, { max: 120, required: true }),
    description: str(body?.description, { max: 2000 }),
    type: oneOf(str(body?.type, { max: 20 }), TYPES, 'mixte'),
    duree_estimee: intOrNull(body?.duree_estimee, { min: 0, max: 24 * 60 }),
    echauffement: str(body?.echauffement, { max: 1000 }),
    retour_au_calme: str(body?.retour_au_calme, { max: 1000 }),
    partage: oneOf(str(body?.partage, { max: 20 }), ['privée', 'lien'], 'privée'),
    items: items.map((it) => ({
      exercise_id: it?.exercise_id != null ? Number(it.exercise_id) : null,
      nom_libre: str(it?.nom_libre, { max: 120 }),
      series: intOrNull(it?.series, { min: 0, max: 1000 }),
      repetitions: intOrNull(it?.repetitions, { min: 0, max: 10000 }),
      temps_travail: intOrNull(it?.temps_travail, { min: 0, max: 36000 }),
      repos: intOrNull(it?.repos, { min: 0, max: 36000 }),
      charge: str(it?.charge, { max: 60 }),
      notes: str(it?.notes, { max: 1000 }),
    })),
  };
}

function sessionWithItems(session) {
  return { ...session, items: [...session.items].sort((a, b) => a.ordre - b.ordre) };
}

function sessionView(session) {
  const view = sessionWithItems(session);
  return { ...view, items: view.items.map(attachExerciseInfo) };
}

function attachExerciseInfo(item) {
  const ex = item.exercise_id ? data.exercises.find((e) => e.id === item.exercise_id) : null;
  return {
    ...item,
    exercise_nom: ex?.nom ?? '',
    exercise_categorie: ex?.categorie ?? null,
    exercise_groupe: ex?.groupe_musculaire ?? '',
    exercise_equipement: ex?.equipement ?? [],
  };
}

function saveSessionItems(session, items) {
  session.items = items.map((it, idx) => ({
    id: nextId('item'),
    session_id: session.id,
    ordre: idx,
    ...it,
  }));
}

function parsePlannedInput(body, { partial = false, existing = null } = {}) {
  const out = {};
  const b = body ?? {};
  if (!partial || 'session_id' in b) {
    const sid = b.session_id;
    out.session_id = sid === undefined || sid === null || sid === '' ? null : Number(sid);
    if (out.session_id !== null && (!Number.isInteger(out.session_id) || !data.sessions.some((s) => s.id === out.session_id))) {
      throw new ApiError(400, 'Session associée introuvable');
    }
  }
  if (!partial || 'titre_libre' in b) out.titre_libre = str(b.titre_libre, { max: 120 });
  if (!partial || 'date' in b) {
    out.date = str(b.date, { max: 10, required: true });
    if (!isValidDate(out.date)) throw new ApiError(400, 'Date invalide (AAAA-MM-JJ)');
  }
  if (!partial || 'heure' in b) {
    const h = b.heure;
    out.heure = h === undefined || h === null || h === '' ? null : str(h, { max: 5 });
    if (out.heure !== null && !HEURE_RE.test(out.heure)) throw new ApiError(400, 'Heure invalide (HH:MM)');
  }
  if (!partial || 'recurrence' in b) out.recurrence = oneOf(str(b.recurrence, { max: 10 }), RECURRENCES, 'none');
  if (!partial || 'jours' in b) {
    const j = b.jours;
    if (j === undefined || j === null) out.jours = [];
    else if (Array.isArray(j) && j.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && j.length <= 7) out.jours = [...new Set(j.map(Number))];
    else throw new ApiError(400, 'jours invalide');
  }
  if (!partial || 'fin_recurrence' in b) {
    const f = b.fin_recurrence;
    out.fin_recurrence = f === undefined || f === null || f === '' ? null : str(f, { max: 10 });
    if (out.fin_recurrence !== null && !isValidDate(out.fin_recurrence)) throw new ApiError(400, 'fin_recurrence invalide');
  }
  if (!partial || 'couleur' in b) out.couleur = str(b.couleur, { max: 20 });
  if (!partial || 'notes' in b) out.notes = str(b.notes, { max: 2000 });
  if ('effectuee' in b) out.effectuee = !!b.effectuee;
  if (partial && existing) {
    const merged = {
      session_id: 'session_id' in out ? out.session_id : existing.session_id,
      titre_libre: 'titre_libre' in out ? out.titre_libre : existing.titre_libre,
      date: 'date' in out ? out.date : existing.date,
      heure: 'heure' in out ? out.heure : existing.heure,
      recurrence: 'recurrence' in out ? out.recurrence : existing.recurrence,
      jours: 'jours' in out ? out.jours : existing.jours,
      fin_recurrence: 'fin_recurrence' in out ? out.fin_recurrence : existing.fin_recurrence,
      couleur: 'couleur' in out ? out.couleur : existing.couleur,
      notes: 'notes' in out ? out.notes : existing.notes,
      effectuee: 'effectuee' in out ? out.effectuee : existing.effectuee,
    };
    if (merged.recurrence === 'custom' && (!merged.jours || merged.jours.length === 0)) throw new ApiError(400, 'La récurrence personnalisée exige au moins un jour');
    if (merged.fin_recurrence && merged.fin_recurrence < merged.date) throw new ApiError(400, 'La fin de récurrence doit être postérieure ou égale à la date de début');
    if (merged.session_id == null && !merged.titre_libre) throw new ApiError(400, 'Indiquez une session ou un titre libre');
    return merged;
  }
  if (out.recurrence === 'custom' && (!out.jours || out.jours.length === 0)) throw new ApiError(400, 'La récurrence personnalisée exige au moins un jour');
  if (out.fin_recurrence && out.date && out.fin_recurrence < out.date) throw new ApiError(400, 'La fin de récurrence doit être postérieure ou égale à la date de début');
  if (out.session_id == null && !out.titre_libre) throw new ApiError(400, 'Indiquez une session ou un titre libre');
  return out;
}

function plannedView(row, occurrenceDate) {
  const session = row.session_id ? data.sessions.find((s) => s.id === row.session_id) : null;
  return {
    ...row,
    logs: row.logs ?? [],
    effectuee: !!row.effectuee,
    couleur: row.couleur || (session ? TYPE_COLORS[session.type] || TYPE_COLORS.libre : TYPE_COLORS.libre),
    session_nom: session ? session.nom : '',
    session_type: session ? session.type : 'libre',
    occurrenceDate: occurrenceDate ?? row.date,
  };
}

function expandPlanned(from, to) {
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new ApiError(400, 'Plage de dates invalide');
  const out = [];
  for (const row of data.planned) {
    const fin = row.fin_recurrence && row.fin_recurrence < to ? row.fin_recurrence : to;
    if (row.recurrence === 'none') {
      if (row.date >= from && row.date <= to) out.push(plannedView(row, row.date));
      continue;
    }
    const joursSet = new Set(row.jours || []);
    let cursor = row.date > from ? row.date : from;
    if (row.recurrence === 'weekly') {
      const targetDow = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      const startDow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      cursor = addDays(cursor, (targetDow - startDow + 7) % 7);
    } else if (row.recurrence === 'custom') {
      while (cursor <= fin && !joursSet.has(new Date(`${cursor}T00:00:00Z`).getUTCDay())) cursor = addDays(cursor, 1);
    }
    while (cursor <= fin) {
      if (cursor >= row.date) out.push(plannedView(row, cursor));
      if (row.recurrence === 'daily') cursor = addDays(cursor, 1);
      else if (row.recurrence === 'weekly') cursor = addDays(cursor, 7);
      else do { cursor = addDays(cursor, 1); } while (cursor <= fin && !joursSet.has(new Date(`${cursor}T00:00:00Z`).getUTCDay()));
    }
  }
  out.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || (a.heure || '').localeCompare(b.heure || ''));
  return out;
}

function historyEntry(row) {
  const session = row.session_id ? data.sessions.find((s) => s.id === row.session_id) : null;
  return {
    id: row.id,
    date: row.date,
    heure: row.heure,
    titre: session ? session.nom : row.titre_libre,
    session_id: row.session_id,
    type: session ? session.type : 'libre',
    duree_estimee: session?.duree_estimee ?? null,
    couleur: row.couleur,
    notes: row.notes,
    recurrence: row.recurrence,
    logs: row.logs ?? [],
  };
}

function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function computeStats(from, to) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const done = data.planned.filter((p) => p.effectuee && inRange(p.date));
  const perWeek = new Map();
  const perMonth = new Map();
  for (const p of done) {
    const wk = weekKey(p.date);
    perWeek.set(wk, (perWeek.get(wk) || 0) + 1);
    const mo = p.date.slice(0, 7);
    perMonth.set(mo, (perMonth.get(mo) || 0) + 1);
  }
  const repartition = new Map();
  for (const p of done) {
    const s = p.session_id ? data.sessions.find((x) => x.id === p.session_id) : null;
    const t = s ? s.type : 'libre';
    repartition.set(t, (repartition.get(t) || 0) + 1);
  }
  const parseCharge = (txt) => {
    const m = /(\d+(?:[.,]\d+)?)/.exec(txt || '');
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  };
  let volume = 0;
  let repsTotal = 0;
  const volumeParSemaine = new Map();
  const volumeParGroupe = new Map();
  const progression = new Map();
  const allItems = data.sessions.flatMap((s) => s.items);
  for (const p of done) {
    for (const l of p.logs ?? []) {
      const s = l.series_realisees || 0;
      const r = l.repetitions_realisees || 0;
      const charge = parseCharge(l.charge_utilisee);
      const v = s * r * charge;
      repsTotal += s * r;
      volume += v;
      const wk = weekKey(p.date);
      volumeParSemaine.set(wk, (volumeParSemaine.get(wk) || 0) + v);
      const item = l.session_exercise_id ? allItems.find((it) => it.id === l.session_exercise_id) : null;
      const groupe = item?.exercise_id ? data.exercises.find((e) => e.id === item.exercise_id)?.groupe_musculaire : '';
      if (groupe) volumeParGroupe.set(groupe, (volumeParGroupe.get(groupe) || 0) + v);
      if (charge > 0 && l.exercice) {
        if (!progression.has(l.exercice)) progression.set(l.exercice, new Map());
        const byWeek = progression.get(l.exercice);
        byWeek.set(wk, Math.max(byWeek.get(wk) || 0, charge));
      }
    }
  }
  const groupes = new Map();
  for (const p of done) {
    const s = p.session_id ? data.sessions.find((x) => x.id === p.session_id) : null;
    if (!s) continue;
    for (const it of s.items) {
      const ex = it.exercise_id ? data.exercises.find((e) => e.id === it.exercise_id) : null;
      if (ex?.groupe_musculaire) groupes.set(ex.groupe_musculaire, (groupes.get(ex.groupe_musculaire) || 0) + 1);
    }
  }
  const weekIndex = (wk) => {
    const [y, w] = wk.split('-').map(Number);
    return y * 53 + w;
  };
  const weeks = [...perWeek.keys()].map(weekIndex).sort((a, b) => b - a);
  let streakSemaines = 0;
  if (weeks.length) {
    let expected = weeks[0];
    for (const w of weeks) {
      if (w === expected) { streakSemaines++; expected--; } else break;
    }
  }
  return {
    totalSeances: done.length,
    parSemaine: [...perWeek.entries()].map(([semaine, n]) => ({ semaine, n })).sort((a, b) => a.semaine.localeCompare(b.semaine)),
    parMois: [...perMonth.entries()].map(([mois, n]) => ({ mois, n })).sort((a, b) => a.mois.localeCompare(b.mois)),
    repartition: [...repartition.entries()].map(([type, n]) => ({ type, n })),
    volumeTotal: Math.round(volume * 10) / 10,
    repetitionsTotales: repsTotal,
    parGroupeMusculaire: [...groupes.entries()].map(([groupe, n]) => ({ groupe, n })).sort((a, b) => b.n - a.n),
    volumeParSemaine: [...volumeParSemaine.entries()].map(([semaine, v]) => ({ semaine, volume: Math.round(v * 10) / 10 })).sort((a, b) => a.semaine.localeCompare(b.semaine)),
    volumeParGroupe: [...volumeParGroupe.entries()].map(([groupe, v]) => ({ groupe, volume: Math.round(v * 10) / 10 })).sort((a, b) => b.volume - a.volume),
    progressionParExercice: [...progression.entries()].map(([exercice, byWeek]) => ({
      exercice,
      points: [...byWeek.entries()].map(([semaine, chargeMax]) => ({ semaine, chargeMax })).sort((a, b) => a.semaine.localeCompare(b.semaine)),
    })).sort((a, b) => a.exercice.localeCompare(b.exercice)),
    streakSemaines,
  };
}

function mediaKeyFromUrl(url) {
  const m = /^(?:\/api\/media\/|idb:\/\/)([a-f0-9]{32})(?:\.[a-z0-9]{1,5})?$/i.exec(String(url || ''));
  return m ? m[1] : null;
}

async function route(method, path, body) {
  const u = new URL(path, 'http://local');
  const p = u.pathname;
  const q = u.searchParams;
  const seg = p.split('/').filter(Boolean);

  if (p === '/api/auth/me' && method === 'GET') {
    return { user: { id: 1, email: 'local', ...data.profile } };
  }
  if (p === '/api/auth/me' && method === 'PUT') {
    data.profile.name = str(body?.name, { max: 100 });
    data.profile.niveau = oneOf(str(body?.niveau, { max: 30 }), NIVEAUX, 'débutant');
    data.profile.objectifs = strArray(body?.objectifs, { maxItems: 10, maxLen: 40 });
    persist();
    return { user: { id: 1, email: 'local', ...data.profile } };
  }
  if (p === '/api/auth/me' && method === 'DELETE') {
    data = emptyData();
    removeKey(DATA_KEY);
    await idbClear();
    persist();
    return { ok: true };
  }
  if (p === '/api/auth/me/export' && method === 'GET') {
    return { exportedAt: new Date().toISOString(), ...data };
  }
  if ((p === '/api/auth/login' || p === '/api/auth/register') && method === 'POST') {
    return { user: { id: 1, email: 'local', ...data.profile } };
  }
  if (p === '/api/auth/logout' && method === 'POST') return { ok: true };
  if (p === '/api/auth/sessions' && method === 'DELETE') return { ok: true };

  if (p === '/api/exercises/facets' && method === 'GET') {
    const groupes = [...new Set(data.exercises.map((e) => e.groupe_musculaire).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const equipements = [...new Set(data.exercises.flatMap((e) => e.equipement))].sort((a, b) => a.localeCompare(b));
    return { groupes, equipements };
  }
  if (p === '/api/exercises' && method === 'GET') {
    let list = [...data.exercises];
    const qq = str(q.get('q'), { max: 100 });
    if (qq) {
      const needle = qq.toLowerCase();
      list = list.filter((e) => [e.nom, e.description, e.groupe_musculaire, ...e.tags].join(' ').toLowerCase().includes(needle));
    }
    if (q.get('categorie') && CATEGORIES.includes(q.get('categorie'))) list = list.filter((e) => e.categorie === q.get('categorie'));
    if (q.get('niveau') && NIVEAUX.includes(q.get('niveau'))) list = list.filter((e) => e.niveau === q.get('niveau'));
    if (q.get('groupe')) list = list.filter((e) => e.groupe_musculaire === q.get('groupe'));
    if (q.get('equipement')) list = list.filter((e) => e.equipement.includes(q.get('equipement')));
    if (q.get('favori') === '1') list = list.filter((e) => e.favori);
    const sort = q.get('sort');
    if (sort === 'nom') list.sort((a, b) => a.nom.localeCompare(b.nom));
    else if (sort === 'ancien') list.sort((a, b) => a.id - b.id);
    else if (sort === 'favori') list.sort((a, b) => (b.favori ? 1 : 0) - (a.favori ? 1 : 0) || a.nom.localeCompare(b.nom));
    else list.sort((a, b) => (b.updated_at - a.updated_at) || b.id - a.id);
    return { exercises: list };
  }
  if (p === '/api/exercises' && method === 'POST') {
    const parsed = parseExerciseInput(body);
    const now = Date.now();
    const ex = { id: nextId('exercise'), ...parsed, created_at: now, updated_at: now };
    data.exercises.push(ex);
    persist();
    return { exercise: ex };
  }
  if (seg[1] === 'exercises' && seg[2] && !seg[3] && method === 'GET') {
    const ex = data.exercises.find((e) => e.id === Number(seg[2]));
    if (!ex) throw new ApiError(404, 'Exercice introuvable');
    return { exercise: ex };
  }
  if (seg[1] === 'exercises' && seg[2] && !seg[3] && method === 'PUT') {
    const ex = data.exercises.find((e) => e.id === Number(seg[2]));
    if (!ex) throw new ApiError(404, 'Exercice introuvable');
    Object.assign(ex, parseExerciseInput(body), { updated_at: Date.now() });
    persist();
    return { exercise: ex };
  }
  if (seg[1] === 'exercises' && seg[2] && seg[3] === 'duplicate' && method === 'POST') {
    const ex = data.exercises.find((e) => e.id === Number(seg[2]));
    if (!ex) throw new ApiError(404, 'Exercice introuvable');
    const now = Date.now();
    const copy = { ...ex, id: nextId('exercise'), nom: `${ex.nom} (copie)`, favori: false, created_at: now, updated_at: now };
    data.exercises.push(copy);
    persist();
    return { exercise: copy };
  }
  if (seg[1] === 'exercises' && seg[2] && seg[3] === 'favori' && method === 'POST') {
    const ex = data.exercises.find((e) => e.id === Number(seg[2]));
    if (!ex) throw new ApiError(404, 'Exercice introuvable');
    ex.favori = !!body?.favori;
    ex.updated_at = Date.now();
    persist();
    return { exercise: ex };
  }
  if (seg[1] === 'exercises' && seg[2] && !seg[3] && method === 'DELETE') {
    const idx = data.exercises.findIndex((e) => e.id === Number(seg[2]));
    if (idx === -1) throw new ApiError(404, 'Exercice introuvable');
    const [ex] = data.exercises.splice(idx, 1);
    const key = mediaKeyFromUrl(ex.media_url);
    if (key) await idbDelete(key);
    persist();
    return { ok: true };
  }

  if (p === '/api/sessions' && method === 'GET') {
    let list = data.sessions.map((s) => ({ id: s.id, nom: s.nom, description: s.description, type: s.type, duree_estimee: s.duree_estimee, partage: s.partage, updated_at: s.updated_at, created_at: s.created_at, nb_exercices: s.items.length }));
    const qq = str(q.get('q'), { max: 100 });
    if (qq) {
      const needle = qq.toLowerCase();
      list = list.filter((s) => `${s.nom} ${s.description}`.toLowerCase().includes(needle));
    }
    if (q.get('type') && TYPES.includes(q.get('type'))) list = list.filter((s) => s.type === q.get('type'));
    list.sort((a, b) => (b.updated_at - a.updated_at) || b.id - a.id);
    return { sessions: list };
  }
  if (p === '/api/sessions' && method === 'POST') {
    const parsed = parseSessionInput(body);
    const now = Date.now();
    const session = {
      id: nextId('session'),
      nom: parsed.nom, description: parsed.description, type: parsed.type,
      duree_estimee: parsed.duree_estimee ?? estimatedDuration(parsed.items),
      echauffement: parsed.echauffement, retour_au_calme: parsed.retour_au_calme,
      partage: parsed.partage, items: [], created_at: now, updated_at: now,
    };
    saveSessionItems(session, parsed.items);
    data.sessions.push(session);
    persist();
    return { session: sessionView(session) };
  }
  if (seg[1] === 'sessions' && seg[2] && !seg[3] && method === 'GET') {
    const s = data.sessions.find((x) => x.id === Number(seg[2]));
    if (!s) throw new ApiError(404, 'Session introuvable');
    return { session: sessionView(s) };
  }
  if (seg[1] === 'sessions' && seg[2] && !seg[3] && method === 'PUT') {
    const s = data.sessions.find((x) => x.id === Number(seg[2]));
    if (!s) throw new ApiError(404, 'Session introuvable');
    const parsed = parseSessionInput(body);
    Object.assign(s, {
      nom: parsed.nom, description: parsed.description, type: parsed.type,
      duree_estimee: parsed.duree_estimee ?? estimatedDuration(parsed.items),
      echauffement: parsed.echauffement, retour_au_calme: parsed.retour_au_calme, partage: parsed.partage,
      updated_at: Date.now(),
    });
    saveSessionItems(s, parsed.items);
    persist();
    return { session: sessionView(s) };
  }
  if (seg[1] === 'sessions' && seg[2] && seg[3] === 'duplicate' && method === 'POST') {
    const s = data.sessions.find((x) => x.id === Number(seg[2]));
    if (!s) throw new ApiError(404, 'Session introuvable');
    const now = Date.now();
    const copy = { ...s, id: nextId('session'), nom: `${s.nom} (copie)`, items: [], created_at: now, updated_at: now };
    copy.items = s.items.map((it) => ({ ...it, id: nextId('item'), session_id: copy.id }));
    data.sessions.push(copy);
    persist();
    return { session: sessionView(copy) };
  }
  if (seg[1] === 'sessions' && seg[2] && seg[3] === 'reorder' && method === 'PUT') {
    const s = data.sessions.find((x) => x.id === Number(seg[2]));
    if (!s) throw new ApiError(404, 'Session introuvable');
    const order = Array.isArray(body?.order) ? body.order.map(Number) : [];
    if (order.length !== s.items.length || !order.every((id) => s.items.some((it) => it.id === id))) {
      throw new ApiError(400, 'Ordre invalide');
    }
    const byId = new Map(s.items.map((it) => [it.id, it]));
    s.items = order.map((id, idx) => ({ ...byId.get(id), ordre: idx }));
    s.updated_at = Date.now();
    persist();
    return { session: sessionView(s) };
  }
  if (seg[1] === 'sessions' && seg[2] && !seg[3] && method === 'DELETE') {
    const idx = data.sessions.findIndex((x) => x.id === Number(seg[2]));
    if (idx === -1) throw new ApiError(404, 'Session introuvable');
    const sid = Number(seg[2]);
    data.sessions.splice(idx, 1);
    for (const p of data.planned) if (p.session_id === sid) p.session_id = null;
    persist();
    return { ok: true };
  }

  if (p === '/api/planned' && method === 'GET') {
    return { planned: expandPlanned(q.get('from') || '', q.get('to') || '') };
  }
  if (p === '/api/planned' && method === 'POST') {
    const parsed = parsePlannedInput(body);
    const row = {
      id: nextId('planned'),
      ...parsed,
      logs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    data.planned.push(row);
    persist();
    return { planned: plannedView(row) };
  }
  if (seg[1] === 'planned' && seg[2] && !seg[3] && method === 'GET') {
    const row = data.planned.find((x) => x.id === Number(seg[2]));
    if (!row) throw new ApiError(404, 'Planification introuvable');
    return { planned: plannedView(row) };
  }
  if (seg[1] === 'planned' && seg[2] && seg[3] === 'logs' && method === 'POST') {
    const row = data.planned.find((x) => x.id === Number(seg[2]));
    if (!row) throw new ApiError(404, 'Planification introuvable');
    const session = row.session_id ? data.sessions.find((s) => s.id === row.session_id) : null;
    const validItemIds = new Set(session ? session.items.map((it) => it.id) : []);
    const logs = (Array.isArray(body?.logs) ? body.logs.slice(0, 200) : []).map((l) => ({
      id: nextId('log'),
      planned_session_id: row.id,
      session_exercise_id: l?.session_exercise_id != null && validItemIds.has(Number(l.session_exercise_id)) ? Number(l.session_exercise_id) : null,
      exercice: str(l?.exercice, { max: 120, required: true }),
      series_realisees: intOrNull(l?.series_realisees, { min: 0, max: 1000 }),
      repetitions_realisees: intOrNull(l?.repetitions_realisees, { min: 0, max: 10000 }),
      charge_utilisee: str(l?.charge_utilisee, { max: 60 }),
      sensation: oneOf(str(l?.sensation, { max: 30 }), ['facile', 'correct', 'difficile', 'très difficile', ''], ''),
      commentaire: str(l?.commentaire, { max: 1000 }),
    }));
    row.logs = logs;
    if (typeof body?.notes === 'string') row.notes = str(body.notes, { max: 2000 });
    if (body?.marquer_effectuee !== false) row.effectuee = true;
    row.updated_at = new Date().toISOString();
    persist();
    return { planned: plannedView(row) };
  }
  if (seg[1] === 'planned' && seg[2] && !seg[3] && method === 'PUT') {
    const row = data.planned.find((x) => x.id === Number(seg[2]));
    if (!row) throw new ApiError(404, 'Planification introuvable');
    const merged = parsePlannedInput(body, { partial: true, existing: row });
    Object.assign(row, merged, { updated_at: new Date().toISOString() });
    persist();
    return { planned: plannedView(row) };
  }
  if (seg[1] === 'planned' && seg[2] && !seg[3] && method === 'DELETE') {
    const idx = data.planned.findIndex((x) => x.id === Number(seg[2]));
    if (idx === -1) throw new ApiError(404, 'Planification introuvable');
    data.planned.splice(idx, 1);
    persist();
    return { ok: true };
  }

  if (p === '/api/history' && method === 'GET') {
    const from = q.get('from') || null;
    const to = q.get('to') || null;
    for (const d of [from, to]) if (d && !isValidDate(d)) throw new ApiError(400, 'Plage de dates invalide');
    if (from && to && from > to) throw new ApiError(400, 'Plage de dates invalide');
    let rows = data.planned.filter((p2) => p2.effectuee);
    if (from) rows = rows.filter((p2) => p2.date >= from);
    if (to) rows = rows.filter((p2) => p2.date <= to);
    if (q.get('type')) {
      const t = q.get('type');
      rows = rows.filter((p2) => {
        const s = p2.session_id ? data.sessions.find((x) => x.id === p2.session_id) : null;
        return t === 'libre' ? !s : s?.type === t;
      });
    }
    if (q.get('groupe')) {
      const g = q.get('groupe');
      rows = rows.filter((p2) => {
        const s = p2.session_id ? data.sessions.find((x) => x.id === p2.session_id) : null;
        if (!s) return false;
        return s.items.some((it) => {
          const ex = it.exercise_id ? data.exercises.find((e) => e.id === it.exercise_id) : null;
          return ex?.groupe_musculaire === g;
        });
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || (b.heure || '').localeCompare(a.heure || '') || b.id - a.id);
    return { history: rows.map(historyEntry) };
  }
  if (p === '/api/stats' && method === 'GET') {
    const from = q.get('from') || null;
    const to = q.get('to') || null;
    for (const d of [from, to]) if (d && !isValidDate(d)) throw new ApiError(400, 'Plage de dates invalide');
    if (from && to && from > to) throw new ApiError(400, 'Plage de dates invalide');
    return { stats: computeStats(from, to) };
  }

  if (seg[1] === 'media' && seg[2] && method === 'DELETE') {
    await idbDelete(seg[2]);
    return { ok: true };
  }

  throw new ApiError(404, 'Route inconnue');
}

export async function api(method, path, body) {
  return route(method, path, body);
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});
export const put = (path, body) => api('PUT', path, body ?? {});
export const del = (path) => api('DELETE', path);

export async function uploadMedia(file) {
  const name = file?.name || 'media';
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  const ext = m ? m[1].toLowerCase() : '';
  const mime = ALLOWED_MEDIA[ext];
  if (!mime) throw new ApiError(400, 'Type de média non autorisé (png, jpg, gif, webp, mp4, webm, mov)');
  const size = file?.size ?? 0;
  if (!size) throw new ApiError(400, 'Fichier vide');
  if (size > MAX_MEDIA_SIZE) throw new ApiError(413, 'Fichier trop volumineux (25 Mo max)');
  const raw = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '');
  const key = raw.slice(0, 32).padEnd(32, '0');
  await idbPut(key, file);
  return { key, mime, size, url: `idb://${key}.${ext}` };
}

export async function exportData() {
  return route('GET', '/api/auth/me/export');
}

export async function mediaBlob(url) {
  const key = mediaKeyFromUrl(url);
  if (!key) return null;
  return idbGet(key);
}

export function resetLocalData() {
  data = emptyData();
  removeKey(DATA_KEY);
  persist();
}
