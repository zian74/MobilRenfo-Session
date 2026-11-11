export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(9)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function field(labelText, input, { hint } = {}) {
  const wrap = h('div', { class: 'field' });
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  wrap.append(h('label', { for: id }, labelText), input);
  if (hint) wrap.append(h('span', { class: 'hint' }, hint));
  return wrap;
}

export function input(type = 'text', attrs = {}) {
  return h('input', { type, ...attrs });
}

export function select(options, attrs = {}) {
  const sel = h('select', attrs);
  for (const opt of options) {
    if (opt === null || opt === undefined) continue;
    const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
    const o = h('option', { value: String(value) }, String(label));
    if (attrs.value !== undefined && String(value) === String(attrs.value)) o.selected = true;
    sel.append(o);
  }
  return sel;
}

export function textarea(attrs = {}) {
  return h('textarea', attrs);
}

export function errorBox(message) {
  return h('div', { class: 'form-error', role: 'alert' }, message);
}

export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  const t = h('div', { class: `toast ${type}`, role: 'status' }, message);
  root.append(t);
  setTimeout(() => t.remove(), 3600);
}

export function modal({ title, content, onClose, wide = false }) {
  const root = document.getElementById('modal-root');
  const closeBtn = h('button', {
    class: 'btn ghost small modal-close',
    'aria-label': 'Fermer',
    onclick: () => close(),
  }, '✕');
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    closeBtn, h('h2', {}, title), content);
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, box);
  root.append(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  }
  return { close, box };
}

export function confirmDialog(message, { confirmLabel = 'Confirmer', danger = true } = {}) {
  return new Promise((resolve) => {
    const content = h('div', {}, h('p', {}, message));
    const yes = h('button', { class: `btn ${danger ? 'danger' : 'primary'}` }, confirmLabel);
    const no = h('button', { class: 'btn' }, 'Annuler');
    content.append(h('div', { class: 'form-actions' }, yes, no));
    const m = modal({ title: 'Confirmation', content });
    yes.addEventListener('click', () => { m.close(); resolve(true); });
    no.addEventListener('click', () => { m.close(); resolve(false); });
  });
}

export function formatDateFr(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDuree(min) {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} min`;
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export function escapeText(s) {
  return String(s ?? '');
}

export function badge(text, cls = '') {
  return h('span', { class: `badge ${cls}` }, text);
}

export function emptyState(message, action) {
  const box = h('div', { class: 'empty-state' }, h('p', {}, message));
  if (action) box.append(action);
  return box;
}

export function loading() {
  return h('div', { class: 'loading', role: 'status' }, 'Chargement…');
}
