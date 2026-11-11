import { get } from '../api.js';
import { h, clear, loading, emptyState } from '../ui.js';

const COUNTDOWN_AVANT = 10;

let activeRun = null;

function unlockAudio() { activeRun?.audio?.resume(); }
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
window.addEventListener('hashchange', () => activeRun?.stop());

function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  return {
    ctx,
    resume() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    beep(freq, dur = 0.15, delay = 0, type = 'sine', gain = 0.22) {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },
  };
}

function soundWork(audio) { audio?.beep(660, 0.12); }
function soundRest(audio) { audio?.beep(440, 0.12); }
function soundEndExercise(audio) {
  if (!audio) return;
  audio.beep(880, 0.14, 0);
  audio.beep(659, 0.14, 0.17);
  audio.beep(880, 0.28, 0.34);
}
function soundEndSession(audio) {
  if (!audio) return;
  [523, 659, 784, 1047].forEach((f, i) => audio.beep(f, 0.18, i * 0.16));
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { }
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export async function renderSessionLive(sessionId) {
  activeRun?.stop();
  const main = document.getElementById('app-main');
  clear(main);
  main.append(loading());
  let session;
  try {
    session = (await get(`/api/sessions/${sessionId}`)).session;
  } catch (e) {
    clear(main).append(h('div', { class: 'card' }, h('p', {}, e.message)));
    return;
  }
  clear(main);

  const steps = (session.items || []).map((it) => ({
    title: it.exercise_nom || it.nom_libre || 'Bloc libre',
    series: it.series > 0 ? it.series : 1,
    reps: it.repetitions || 0,
    work: it.temps_travail || 0,
    rest: it.repos || 0,
    charge: it.charge || '',
    notes: it.notes || '',
  }));
  if (!steps.length) {
    main.append(h('div', { class: 'card' },
      emptyState('Cette session ne contient aucun exercice.', h('a', { class: 'btn primary', href: `#/sessions/${session.id}` }, '← Modifier la session'))));
    return;
  }

  const run = {
    audio: createAudio(),
    phase: 'intro',
    ei: 0,
    si: 1,
    endAt: 0,
    remainingMs: 0,
    paused: false,
    lastWhole: null,
    timer: null,
    stop() {
      clearInterval(this.timer);
      this.timer = null;
      if (activeRun === this) activeRun = null;
    },
  };
  activeRun = run;
  run.audio?.resume();

  const phaseEl = h('div', { class: 'live-phase' }, '');
  const exEl = h('div', { class: 'live-exercise' }, '');
  const metaEl = h('div', { class: 'live-meta' }, '');
  const timerEl = h('div', { class: 'live-timer', role: 'timer', 'aria-live': 'off' }, '');
  const progressFill = h('div', {});
  const progressBar = h('div', { class: 'live-progress', role: 'progressbar' }, progressFill);
  const nextEl = h('div', { class: 'live-next' }, '');
  const controls = h('div', { class: 'live-controls' });
  const countEl = h('span', { class: 'muted small' }, '');
  const stage = h('div', { class: 'live-stage intro' },
    phaseEl, exEl, metaEl, timerEl, progressBar, nextEl, controls);

  const totalSeries = steps.reduce((a, s) => a + s.series, 0);

  function paintTimer() {
    if (run.phase === 'done') { timerEl.textContent = '✓'; return; }
    const it = steps[run.ei];
    if (run.phase === 'work' && it.work <= 0) { timerEl.textContent = 'GO'; return; }
    const rem = run.paused ? run.remainingMs : Math.max(0, run.endAt - Date.now());
    timerEl.textContent = fmt(Math.ceil(rem / 1000));
  }

  function paintProgress() {
    let done;
    if (run.phase === 'done') done = totalSeries;
    else {
      done = steps.slice(0, run.ei).reduce((a, s) => a + s.series, 0);
      done += run.phase === 'rest' ? Math.min(run.si, steps[run.ei].series) : Math.max(0, run.si - 1);
    }
    progressFill.style.width = `${Math.min(100, (done / totalSeries) * 100)}%`;
    progressBar.setAttribute('aria-valuenow', String(done));
    progressBar.setAttribute('aria-valuemax', String(totalSeries));
  }

  function paintControls() {
    clear(controls);
    const quit = h('a', { class: 'btn small danger', href: `#/sessions/${session.id}/lecture`, onclick: () => run.stop() }, '✕ Quitter');
    if (run.phase === 'done') {
      controls.append(h('a', { class: 'btn primary', href: `#/sessions/${session.id}/lecture`, onclick: () => run.stop() }, '✓ Terminer'), quit);
      return;
    }
    const timed = run.phase !== 'work' || steps[run.ei].work > 0;
    if (timed) {
      controls.append(h('button', {
        class: 'btn small',
        onclick: () => {
          if (run.paused) {
            run.endAt = Date.now() + run.remainingMs;
            run.paused = false;
            run.lastWhole = null;
          } else {
            run.remainingMs = Math.max(0, run.endAt - Date.now());
            run.paused = true;
          }
          paint();
        },
      }, run.paused ? '▶ Reprendre' : '⏸ Pause'));
    }
    controls.append(
      h('button', { class: 'btn small', onclick: () => { run.paused = false; endOfWork(); } }, run.phase === 'work' && steps[run.ei].work <= 0 ? '✓ Série terminée' : '⏭ Série suivante'),
      h('button', { class: 'btn small', onclick: () => { run.paused = false; skipExercise(); } }, '⏩ Exercice suivant'),
      quit);
  }

  function paint() {
    stage.className = `live-stage ${run.phase}${run.paused ? ' paused' : ''}`;
    if (run.phase === 'done') {
      phaseEl.textContent = 'Séance terminée';
      exEl.textContent = 'Bravo ! 🎉';
      metaEl.textContent = `${steps.length} exercice${steps.length > 1 ? 's' : ''} terminé${steps.length > 1 ? 's' : ''}`;
      nextEl.textContent = session.retour_au_calme ? `Retour au calme : ${session.retour_au_calme}` : '';
    } else {
      const it = steps[run.ei];
      phaseEl.textContent = { intro: 'Prépare-toi…', work: 'Travail', rest: 'Repos' }[run.phase];
      exEl.textContent = `${run.ei + 1}. ${it.title}`;
      const parts = [`Série ${run.si}/${it.series}`];
      if (it.reps) parts.push(`${it.reps} répétitions`);
      if (it.work) parts.push(`${it.work} s de travail`);
      if (it.rest) parts.push(`repos ${it.rest} s`);
      if (it.charge) parts.push(it.charge);
      metaEl.textContent = parts.join(' · ');
      const next = steps[run.ei + 1];
      nextEl.textContent = next ? `Exercice suivant : ${next.title}` : '';
    }
    countEl.textContent = run.phase === 'done'
      ? `${steps.length}/${steps.length} exercices`
      : `Exercice ${Math.min(run.ei + 1, steps.length)}/${steps.length}`;
    paintTimer();
    paintProgress();
    paintControls();
  }

  function startCountdown(seconds, phase) {
    run.phase = phase;
    run.paused = false;
    run.lastWhole = null;
    run.remainingMs = seconds * 1000;
    run.endAt = Date.now() + seconds * 1000;
    if (!run.timer) run.timer = setInterval(tick, 200);
    paint();
  }

  function startWork() {
    const it = steps[run.ei];
    if (it.work > 0) {
      soundWork(run.audio);
      vibrate(60);
      startCountdown(it.work, 'work');
    } else {
      run.phase = 'work';
      run.paused = false;
      run.endAt = 0;
      run.remainingMs = 0;
      if (!run.timer) run.timer = setInterval(tick, 500);
      paint();
    }
  }

  function endOfWork() {
    const it = steps[run.ei];
    const lastSeries = run.si >= it.series;
    if (lastSeries) {
      soundEndExercise(run.audio);
      vibrate([120, 60, 120]);
    } else if (it.rest > 0) {
      soundRest(run.audio);
    }
    if (it.rest > 0) startCountdown(it.rest, 'rest');
    else if (lastSeries) nextExercise();
    else { run.si += 1; startWork(); }
  }

  function endOfRest() {
    const it = steps[run.ei];
    if (run.si >= it.series) nextExercise();
    else { run.si += 1; startWork(); }
  }

  function nextExercise() {
    if (run.ei >= steps.length - 1) {
      run.phase = 'done';
      run.paused = false;
      soundEndSession(run.audio);
      vibrate([200, 80, 200, 80, 300]);
      paint();
      return;
    }
    run.ei += 1;
    run.si = 1;
    startWork();
  }

  function skipExercise() {
    if (run.ei >= steps.length - 1) {
      run.phase = 'done';
      soundEndSession(run.audio);
      paint();
      return;
    }
    run.ei += 1;
    run.si = 1;
    startWork();
  }

  function tick() {
    if (run.paused || run.phase === 'done' || run.phase === 'work' && steps[run.ei].work <= 0) { paintTimer(); return; }
    const rem = Math.max(0, run.endAt - Date.now());
    run.remainingMs = rem;
    const whole = Math.ceil(rem / 1000);
    if (run.phase === 'intro' && whole <= 3 && whole > 0 && whole !== run.lastWhole) {
      run.lastWhole = whole;
      run.audio?.beep(520, 0.08);
    }
    paintTimer();
    paintProgress();
    if (rem <= 0) {
      if (run.phase === 'intro') startWork();
      else if (run.phase === 'work') endOfWork();
      else if (run.phase === 'rest') endOfRest();
    }
  }

  main.append(
    h('div', { class: 'live-run' },
      h('div', { class: 'live-head' },
        h('div', {}, h('strong', {}, session.nom), ' ', countEl),
        h('a', { class: 'btn small', href: `#/sessions/${session.id}/lecture`, onclick: () => run.stop() }, '✕ Quitter')),
      stage));

  startCountdown(COUNTDOWN_AVANT, 'intro');
}
