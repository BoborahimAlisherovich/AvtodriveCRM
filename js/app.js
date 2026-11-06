// Ilova kirish nuqtasi: router, layout, global qisqa tugmalar.
import { me, ROLES } from './auth.js';
import { init, signOut, badges, mode } from './data/api.js';
import { $, esc, icon, initials, closeDrawer } from './ui.js';
import { renderLogin } from './pages/login.js';
import { newLeadModal } from './components/leadCard.js';
import * as dashboard from './pages/dashboard.js';
import * as leads from './pages/leads.js';
import * as payments from './pages/payments.js';
import * as staff from './pages/staff.js';
import * as attendance from './pages/attendance.js';
import * as reports from './pages/reports.js';
import * as logs from './pages/logs.js';
import * as courses from './pages/courses.js';
import * as telegram from './pages/telegram.js';
import * as settings from './pages/settings.js';

const ALL = ['admin', 'roop', 'seller'];
const MENU = [
  { id: 'dashboard', title: 'Dashboard', sellerTitle: 'Mening kabinetim', icon: 'dashboard', roles: ALL, page: dashboard },
  { id: 'leads', title: 'Leadlar', icon: 'leads', roles: ALL, page: leads },
  { id: 'payments', title: "To'lovlar", icon: 'payments', roles: ALL, page: payments },
  { id: 'staff', title: 'Xodimlar', icon: 'staff', roles: ['admin'], page: staff },
  { id: 'attendance', title: 'Davomat', icon: 'attendance', roles: ['admin', 'roop'], page: attendance },
  { id: 'reports', title: 'Hisobotlar', icon: 'reports', roles: ['admin', 'roop'], page: reports },
  { id: 'logs', title: 'Activity Log', icon: 'log', roles: ALL, page: logs },
  { id: 'courses', title: 'Kurslar', icon: 'courses', roles: ALL, page: courses },
  { id: 'telegram', title: 'Telegram', icon: 'telegram', roles: ['admin', 'roop'], page: telegram },
  { id: 'settings', title: 'Sozlamalar', icon: 'settings', roles: ['admin'], page: settings },
];

const app = $('#app');
let shellFor = null;

function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { id: path || 'dashboard', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function go(id, params) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const target = `#/${id}${qs}`;
  if (location.hash === target) route(); else location.hash = target;
}

function menuFor(u) { return MENU.filter(m => m.roles.includes(u.role)); }

function renderShell(u) {
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="brand-logo">B</div><div><b>B va Express</b><small>CRM</small></div></div>
      <nav class="nav" id="nav">${menuFor(u).map(m => `<a href="#/${m.id}" data-id="${m.id}">${icon(m.icon)}<span>${esc(u.role === 'seller' && m.sellerTitle || m.title)}</span><span class="cnt" hidden></span></a>`).join('')}</nav>
      <div class="side-foot">${mode === 'demo' ? "Demo rejim · ma'lumotlar brauzerda saqlanadi" : 'B va Express CRM'}</div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="icon-btn burger" id="burger" aria-label="Menyu">${icon('menu')}</button>
        <h1 id="page-title"></h1>
        <div class="gsearch">${icon('search')}<input id="gsearch" type="search" placeholder="Lead qidirish: ism yoki telefon   ( / )"></div>
        <div class="top-right">
          <button class="btn primary" id="new-lead" title="Yangi lead (N)">${icon('plus')}<span class="lbl">Lead</span></button>
          <div class="user-chip"><div class="avatar">${esc(initials(u.full_name))}</div><div><div class="nm">${esc(u.full_name)}</div><div class="rl">${ROLES[u.role]}</div></div></div>
          <button class="icon-btn" id="logout" title="Chiqish">${icon('logout')}</button>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div></div>`;
  shellFor = u.id;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  $('#nav').onclick = () => $('#side').classList.remove('open');
  $('#logout').onclick = async () => { await signOut(); shellFor = null; location.hash = ''; route(); };
  $('#new-lead').onclick = () => newLeadModal(() => route());
  $('#gsearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') { go('leads', { q: e.target.value.trim(), view: 'table' }); }
  });
}

async function updateCounts() {
  const set = (id, n, cls = '') => {
    const el = $(`#nav a[data-id="${id}"] .cnt`);
    if (!el) return;
    el.hidden = !n;
    el.textContent = n;
    el.className = 'cnt ' + cls;
  };
  try {
    const b = await badges();
    set('leads', b.fresh, 'blue');
    set('payments', b.debts);
  } catch { /* belgilar ixtiyoriy */ }
}

async function route() {
  closeDrawer();
  const u = me();
  if (!u) { shellFor = null; renderLogin(app, () => route()); return; }
  if (shellFor !== u.id) renderShell(u);
  const { id, params } = parseHash();
  const items = menuFor(u);
  const item = items.find(m => m.id === id) || items[0];
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.id === item.id);
  $('#page-title').textContent = u.role === 'seller' && item.sellerTitle || item.title;
  document.title = `${item.title} · B va Express CRM`;
  const content = $('#content');
  content.onclick = content.oninput = content.onchange = null;
  try {
    await item.page.render(content, params, { refreshCounts: updateCounts });
  } catch (e) {
    console.error(e);
    content.innerHTML = `<div class="panel empty">Xatolik: ${esc(e.message)}</div>`;
  }
  updateCounts();
}

document.addEventListener('keydown', e => {
  if (!me() || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target.closest('input,textarea,select,[contenteditable]');
  if (typing || $('.modal-back')) return;
  if (e.key === '/') { e.preventDefault(); $('#gsearch')?.focus(); }
  if (e.key === 'n' || e.key === 'т') { e.preventDefault(); newLeadModal(() => route()); }
});

addEventListener('hashchange', route);
addEventListener('crm:changed', () => { if (me()) updateCounts(); });
init()
  .catch(e => { console.error(e); })
  .finally(route);
