export function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function shareUrlForSession(session) {
  const payload = {
    v: 1,
    nom: session.nom,
    description: session.description || '',
    type: session.type,
    duree_estimee: session.duree_estimee ?? null,
    echauffement: session.echauffement || '',
    retour_au_calme: session.retour_au_calme || '',
    items: (session.items || []).map((it) => ({
      nom: it.exercise_nom || it.nom_libre || 'Bloc libre',
      series: it.series, repetitions: it.repetitions, temps_travail: it.temps_travail,
      repos: it.repos, charge: it.charge || '', notes: it.notes || '',
    })),
  };
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/partage/${encodeShare(payload)}`;
}
