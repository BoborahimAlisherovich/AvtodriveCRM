// To'lovlar: barcha to'lovlar, muddatlar va qarzdorlik.
import { payments, courses, staff, PAY_STATUS, today } from '../data/api.js';
import { can } from '../auth.js';
import { esc, money, fmtDate, fmtDT, fmtPhone, options, badge, icon, toast, debounce, pager, $ } from '../ui.js';
import { createPaymentModal, receiveModal, editModal, openPayment } from '../components/payForms.js';
import { exportExcel } from '../excel.js';

const st = { q: '', status: '', owner: '', course: '', page: 1, size: 50 };
let root;
const filters = () => ({ q: st.q, status: st.status, owner: st.owner, course: st.course });

export async function render(el, params) {
  root = el;
  if (params.status !== undefined) st.status = params.status;
  const all = can('payments.all');
  el.innerHTML = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="inp" data-f="q" type="search" placeholder="Mijoz ismi yoki telefon" value="${esc(st.q)}"></div>
      <div class="seg" data-seg>${[['', 'Hammasi'], ...Object.entries(PAY_STATUS).map(([k, v]) => [k, v.name])].map(([k, t]) => `<button data-status="${k}" class="${st.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${all ? `<select class="sel" data-f="owner">${options(staff.sellers().map(s => [s.id, s.full_name]), st.owner, { empty: 'Barcha sotuvchilar' })}</select>` : ''}
      <select class="sel" data-f="course">${options(courses.list({ includeInactive: true }).map(c => [c.id, c.name]), st.course, { empty: 'Barcha kurslar' })}</select>
      <div class="grow"></div>
      <button class="btn" data-act="export">${icon('excel')} Excel</button>
      ${can('payments.create') ? `<button class="btn primary" data-act="new">${icon('plus')} To'lov</button>` : ''}
    </div><div data-body></div>`;
  await draw();
  const search = debounce(() => { st.page = 1; draw(); }, 200);
  el.oninput = e => { if (e.target.matches('[data-f="q"]')) { st.q = e.target.value; search(); } };
  el.onchange = e => { const f = e.target.dataset.f; if (f && f !== 'q') { st[f] = e.target.value; st.page = 1; draw(); } };
  el.onclick = onClick;
}

async function draw() {
  const { rows, total, totals } = await payments.list({ ...filters(), page: st.page, size: st.size });
  const editable = can('payments.edit');
  $('[data-body]', root).innerHTML = `<div class="kpis">
      <div class="kpi"><div class="t">Shartnomalar summasi</div><div class="v money">${money(totals.total)}</div></div>
      <div class="kpi" style="--c:var(--ok)"><div class="t">To'langan</div><div class="v money">${money(totals.paid)}</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="t">Kutilayotgan (qolgan)</div><div class="v money">${money(totals.remaining - totals.debt)}</div></div>
      <div class="kpi" style="--c:var(--danger)"><div class="t">Qarzdorlik</div><div class="v money">${money(totals.debt)}</div><div class="d">${totals.debtors} ta mijoz</div></div>
    </div>
    <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Mijoz</th><th>Telefon</th><th>Kurs</th><th>Sotuvchi</th><th class="num">Umumiy</th><th class="num">To'langan</th><th class="num">Qolgan</th><th>Muddat</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${rows.map(p => `<tr class="click" data-open="${p.id}">
      <td class="name-cell"><b>${esc(p.lead_name)}</b></td>
      <td class="nowrap">${esc(fmtPhone(p.phone))}</td>
      <td>${esc(p.course_name)}</td>
      <td class="nowrap">${esc(p.owner_name)}</td>
      <td class="num">${money(p.total)}</td>
      <td class="num">${money(p.paid)}</td>
      <td class="num ${p.status === 'qarzdor' ? 'red' : ''}"><b>${money(p.remaining)}</b></td>
      <td class="nowrap ${p.status === 'qarzdor' ? 'red' : ''}">${fmtDate(p.due)}</td>
      <td>${badge(PAY_STATUS[p.status].name, PAY_STATUS[p.status].color)}</td>
      <td class="nowrap" style="text-align:right">
        ${p.remaining > 0 && p.status !== 'bekor' ? `<button class="btn sm" data-receive="${p.id}">Qabul</button>` : ''}
        ${editable && p.status !== 'bekor' ? `<button class="icon-btn" data-edit="${p.id}" title="Tahrirlash">${icon('edit')}</button>` : ''}
      </td></tr>`).join('')}
    </tbody></table></div>
    ${rows.length ? '' : `<div class="empty">To'lov topilmadi</div>`}
    ${pager(total, st.page, st.size)}</div>`;
  root._rows = rows;
}

async function onClick(e) {
  const t = e.target;
  const s = t.closest('[data-status]');
  if (s) {
    st.status = s.dataset.status; st.page = 1;
    for (const b of root.querySelectorAll('[data-seg] button')) b.classList.toggle('on', b === s);
    return draw();
  }
  const pg = t.closest('[data-page]');
  if (pg) { st.page = Number(pg.dataset.page); return draw(); }
  const rec = t.closest('[data-receive]');
  if (rec) return receiveModal(root._rows.find(p => p.id === rec.dataset.receive), draw);
  const ed = t.closest('[data-edit]');
  if (ed) return editModal(root._rows.find(p => p.id === ed.dataset.edit), draw);
  const open = t.closest('[data-open]');
  if (open) return openPayment(open.dataset.open, draw);
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'new') createPaymentModal({ onDone: draw });
  if (act === 'export') {
    try {
      const { all } = await payments.list({ ...filters(), size: 1e9 });
      await exportExcel(`tolovlar_${today()}.xlsx`, [{
        name: "To'lovlar",
        rows: all.map(p => ({
          'Mijoz': p.lead_name, 'Telefon': p.phone, 'Kurs': p.course_name, 'Sotuvchi': p.owner_name,
          'Umumiy summa': p.total, "To'langan": p.paid, 'Qolgan': p.remaining, "To'lov muddati": fmtDate(p.due_date),
          "Keyingi to'lov": fmtDate(p.next_date), 'Status': PAY_STATUS[p.status].name, 'Yaratilgan': fmtDT(p.created_at), 'Izoh': p.note,
        })),
      }]);
      toast(`${all.length} ta to'lov Excelga yuklandi`);
    } catch (ex) { toast(ex.message, 'err'); }
  }
}
