// Activity Log: tizimdagi muhim amallar tarixi. Faqat o'qish uchun.
import { logs, staff, ACTIONS, profileName, today } from '../data/api.js';
import { can } from '../auth.js';
import { esc, fmtDT, fmtDate, money, options, icon, debounce, pager, toast, $ } from '../ui.js';
import { openLead } from '../components/leadCard.js';
import { openPayment } from '../components/payForms.js';
import { exportExcel } from '../excel.js';

const st = { user: '', action: '', from: '', to: '', q: '', page: 1, size: 50 };
const GROUPS = [['lead', 'Leadlar'], ['pay', "To'lovlar"], ['att', 'Davomat'], ['staff', 'Xodimlar'], ['stage', 'Bosqichlar'], ['course', 'Kurslar'], ['settings', 'Sozlamalar'], ['tg', 'Telegram']];
let root;
const filters = () => ({ user: st.user, action: st.action, from: st.from, to: st.to, q: st.q });

export async function render(el) {
  root = el;
  const all = can('logs.all');
  el.innerHTML = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="inp" data-f="q" type="search" placeholder="Mijoz yoki obyekt nomi" value="${esc(st.q)}"></div>
      ${all ? `<select class="sel" data-f="user">${options([['system', 'Tizim'], ...staff.list().map(p => [p.id, p.full_name])], st.user, { empty: 'Barcha foydalanuvchilar' })}</select>` : ''}
      <select class="sel" data-f="action">${options([...GROUPS, ...Object.entries(ACTIONS)], st.action, { empty: 'Barcha amallar' })}</select>
      <input class="inp" type="date" data-f="from" value="${st.from}"><input class="inp" type="date" data-f="to" value="${st.to}">
      <div class="grow"></div><button class="btn" data-export>${icon('excel')} Excel</button>
    </div><div data-body></div>`;
  await draw();
  const search = debounce(() => { st.page = 1; draw(); }, 200);
  el.oninput = e => { if (e.target.matches('[data-f="q"]')) { st.q = e.target.value; search(); } };
  el.onchange = e => { const f = e.target.dataset.f; if (f && f !== 'q') { st[f] = e.target.value; st.page = 1; draw(); } };
  el.onclick = onClick;
}

const FIELD = { first_name: 'Ism', last_name: 'Familiya', phone: 'Telefon', source: 'Manba', course_id: 'Toifa', next_contact_at: 'Keyingi aloqa', comment: 'Izoh', birthday: "Tug'ilgan kun", total: 'Summa', paid: "To'langan", due_date: 'Muddat', next_date: "Keyingi to'lov", note: 'Izoh', role: 'Rol', active: 'Faol', full_name: 'Ism', email: 'Login', position: 'Lavozim', work_start: 'Kelish', work_end: 'Ketish', schedule: 'Jadval' };

function val(r, v, key) {
  if (v === null || v === undefined || v === '') return '—';
  if (r.action === 'lead.transfer' || r.action === 'lead.assign') return profileName(v);
  if (typeof v === 'number' && r.entity === 'payment') return money(v);
  if (key === 'total' || key === 'paid') return money(v);
  if (key && /date$/.test(key)) return fmtDate(v);
  if (key === 'next_contact_at') return fmtDT(v);
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${FIELD[k] || k}: ${Array.isArray(x) ? x.join(', ') : x ?? '—'}`).join('; ');
  return String(v);
}

function change(r) {
  if (r.old && r.new && typeof r.new === 'object') {
    return Object.keys(r.new).map(k => `${FIELD[k] || k}: <s class="muted">${esc(val(r, r.old[k], k))}</s> → <b>${esc(val(r, r.new[k], k))}</b>`).join('<br>');
  }
  if (r.old !== null && r.old !== undefined && r.old !== '') return `<s class="muted">${esc(val(r, r.old))}</s> → <b>${esc(val(r, r.new))}</b>`;
  return r.new !== null && r.new !== undefined ? esc(val(r, r.new)) : '';
}

async function draw() {
  const { rows, total } = await logs.list({ ...filters(), page: st.page, size: st.size });
  $('[data-body]', root).innerHTML = `<div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Vaqt</th><th>Foydalanuvchi</th><th>Amal</th><th>Obyekt</th><th>O'zgarish (eski → yangi)</th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td class="nowrap">${fmtDT(r.created_at)}</td>
      <td class="nowrap">${esc(r.user)}</td>
      <td class="nowrap"><span class="tag">${esc(r.action_name)}</span></td>
      <td>${r.entity_id && (r.entity === 'lead' || r.entity === 'payment') ? `<a href="#" data-${r.entity}="${r.entity_id}">${esc(r.label)}</a>` : esc(r.label || '')}</td>
      <td class="small">${change(r)}</td></tr>`).join('')}
    </tbody></table></div>
    ${rows.length ? '' : '<div class="empty">Yozuv topilmadi</div>'}
    ${pager(total, st.page, st.size)}</div>
    <p class="muted small">Loglarni hech kim o'zgartira yoki o'chira olmaydi.${can('logs.all') ? '' : ' Siz faqat o\'z amallaringizni ko\'rasiz.'}</p>`;
}

async function onClick(e) {
  const pg = e.target.closest('[data-page]');
  if (pg) { st.page = Number(pg.dataset.page); return draw(); }
  const l = e.target.closest('[data-lead]');
  if (l) { e.preventDefault(); return openLead(l.dataset.lead, draw); }
  const p = e.target.closest('[data-payment]');
  if (p) { e.preventDefault(); return openPayment(p.dataset.payment, draw); }
  if (e.target.closest('[data-export]')) {
    try {
      const { all } = await logs.list(filters());
      const rows = await all();
      await exportExcel(`activity_log_${today()}.xlsx`, [{
        name: 'Activity Log',
        rows: rows.map(r => ({ 'Vaqt': fmtDT(r.created_at), 'Foydalanuvchi': r.user, 'Amal': r.action_name, 'Obyekt': r.label, 'Eski': val(r, r.old), 'Yangi': val(r, r.new) })),
      }]);
    } catch (ex) { toast(ex.message, 'err'); }
  }
}
