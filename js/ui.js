// Umumiy UI yordamchilari: formatlash, modal, drawer, toast, ikonlar.
import { ymd } from './data/api.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const num = n => Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = n => `${num(n)} so'm`;

export function fmtDate(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}.${m}.${y}`; }
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
export function fmtDT(v) {
  if (!v) return '';
  const d = new Date(v);
  return `${fmtDate(v)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12) return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  return p || '';
}
// datetime-local input uchun qiymat
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const initials = name => String(name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function badge(name, color, cls = '') {
  return `<span class="badge ${cls}" style="--c:${esc(color)}">${esc(name)}</span>`;
}

export function options(list, selected, { empty } = {}) {
  let html = empty !== undefined ? `<option value="">${esc(empty)}</option>` : '';
  for (const o of list) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    html += `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(t)}</option>`;
  }
  return html;
}

/* ---------------- toast ---------------- */
export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 5000 : 3000);
}

/* ---------------- modal ---------------- */
// onSubmit(values, form) xato tashlasa, xabar modal ichida ko'rsatiladi
export function modal({ title, body, submit = 'Saqlash', cancel = 'Bekor qilish', wide = false, danger = false, onSubmit, onMount }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate autocomplete="off">
      <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">${icon('close')}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${submit ? `<button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(submit)}</button>` : ''}
        <button type="button" class="btn light" data-close>${esc(cancel)}</button>
        <div class="err"></div>
      </div></form>`;
    document.body.append(back);
    const form = back.firstElementChild;
    const err = $('.err', form);
    const prevFocus = document.activeElement;
    const close = v => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(null); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.textContent = '';
      const btn = $('button[type=submit]', form);
      if (btn) btn.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(form));
        const r = onSubmit ? await onSubmit(values, form) : values;
        close(r === undefined ? true : r);
      } catch (ex) {
        err.textContent = ex.message;
        if (btn) btn.disabled = false;
      }
    });
    onMount?.(form);
    ($('[autofocus]', form) || $('input:not([type=hidden]),select,textarea', form))?.focus();
  });
}

export function confirmBox(text, { title = 'Tasdiqlang', ok = 'Ha', danger = false } = {}) {
  return modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, submit: ok, danger, onSubmit: () => true });
}

/* ---------------- drawer (o'ng panel) ---------------- */
let drawerEl = null;
export function openDrawer({ onClose } = {}) {
  closeDrawer();
  const back = document.createElement('div');
  back.className = 'drawer-back';
  const d = document.createElement('aside');
  d.className = 'drawer';
  document.body.append(back, d);
  const onKey = e => { if (e.key === 'Escape' && !$('.modal-back')) closeDrawer(); };
  document.addEventListener('keydown', onKey);
  back.onclick = () => closeDrawer();
  drawerEl = { d, back, onKey, onClose };
  return d;
}
export function closeDrawer() {
  if (!drawerEl) return;
  const { d, back, onKey, onClose } = drawerEl;
  drawerEl = null;
  d.remove(); back.remove();
  document.removeEventListener('keydown', onKey);
  onClose?.();
}

/* ---------------- davr filtri ---------------- */
export const PERIODS = [['today', 'Bugun'], ['week', 'Hafta'], ['month', 'Oy'], ['all', 'Hammasi'], ['custom', 'Oraliq']];
export function periodRange(p) {
  const t = new Date();
  if (p.kind === 'today') return { from: ymd(t), to: ymd(t) };
  if (p.kind === 'week') { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: ymd(d), to: ymd(t) }; }
  if (p.kind === 'month') return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(t) };
  if (p.kind === 'custom') return { from: p.from || '', to: p.to || '' };
  return { from: '', to: '' };
}
export function periodBar(p) {
  return `<div class="seg" data-period>${PERIODS.map(([k, t]) => `<button type="button" data-kind="${k}" class="${p.kind === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${p.kind === 'custom' ? `<input type="date" class="inp" data-pfrom value="${esc(p.from || '')}"> — <input type="date" class="inp" data-pto value="${esc(p.to || '')}">` : ''}`;
}
// davr tugmalari bosilganda holatni yangilaydi; o'zgarsa true qaytaradi
export function handlePeriod(e, p) {
  const b = e.target.closest('[data-period] button');
  if (b) { p.kind = b.dataset.kind; return true; }
  if (e.type === 'change' && e.target.matches('[data-pfrom]')) { p.from = e.target.value; return true; }
  if (e.type === 'change' && e.target.matches('[data-pto]')) { p.to = e.target.value; return true; }
  return false;
}

export function pager(total, page, size) {
  if (total <= size) return `<div class="pager">Jami: ${total}</div>`;
  const pages = Math.ceil(total / size);
  return `<div class="pager"><span>${(page - 1) * size + 1}–${Math.min(total, page * size)} / ${total}</span>
    <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Oldingi</button>
    <button class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Keyingi ›</button></div>`;
}

/* ---------------- ikonlar ---------------- */
const P = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  leads: '<path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
  payments: '<path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16zm0-10H4V6h16z"/>',
  staff: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
  attendance: '<path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14zM10.6 17.4 7 13.8l1.4-1.4 2.2 2.2 5-5L17 11z"/>',
  reports: '<path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>',
  log: '<path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z"/>',
  courses: '<path d="M12 3 1 9l11 6 9-4.91V17h2V9zM5 13.18v4L12 21l7-3.82v-4L12 17z"/>',
  telegram: '<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>',
  settings: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  menu: '<path d="M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  logout: '<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4z"/>',
  excel: '<path d="M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z"/>',
  upload: '<path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>',
  kanban: '<path d="M4 5h4v14H4zm6 0h4v9h-4zm6 0h4v11h-4z"/>',
  table: '<path d="M3 3v18h18V3zm8 16H5v-6h6zm0-8H5V5h6zm8 8h-6v-6h6zm0-8h-6V5h6z"/>',
  phone: '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02z"/>',
  note: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
  swap: '<path d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99zM21 9l-3.99-4v3H10v2h7.01v3z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/>',
  dots: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>',
  money: '<path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>',
  link: '<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P[name] || ''}</svg>`;
}
