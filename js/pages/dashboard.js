// Dashboard (FULL ADMIN, ROOP) va sotuvchining shaxsiy kabineti.
import { dashboard, leads, ATT } from '../data/api.js';
import { me, ROLES } from '../auth.js';
import { esc, money, num, fmtDT, fmtDate, fmtPhone, badge, periodBar, periodRange, handlePeriod, initials, icon } from '../ui.js';
import { openLead } from '../components/leadCard.js';
import { openPayment } from '../components/payForms.js';

const period = { kind: 'month', from: '', to: '' };
let root;

export async function render(el) {
  root = el;
  await draw();
  const onP = e => { const c = handlePeriod(e, period); if (c) draw(); return c; };
  el.onclick = e => {
    if (onP(e)) return;
    const l = e.target.closest('[data-lead]');
    if (l) return openLead(l.dataset.lead, draw);
    const p = e.target.closest('[data-pay]');
    if (p) return openPayment(p.dataset.pay, draw);
  };
  el.onchange = onP;
}

const kpi = (t, v, c, d = '', isMoney = false) =>
  `<div class="kpi" style="--c:${c}"><div class="t">${t}</div><div class="v ${isMoney ? 'money' : ''}">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;

function leadRow(l, showDue) {
  const late = l.next_contact_at && new Date(l.next_contact_at) < new Date();
  return `<div class="list-row click" data-lead="${l.id}">
    <div class="grow"><b>${esc(l.name)}</b> <span class="muted small">${esc(fmtPhone(l.phone))}</span>
      <div class="small muted">${esc(l.owner_name || '')}${l.course_name ? ' · ' + esc(l.course_name) : ''}</div></div>
    ${showDue ? `<span class="due ${late ? 'late' : ''}">${fmtDT(l.next_contact_at)}</span>` : `<span class="small muted">${fmtDT(l.created_at)}</span>`}
    ${badge(l.status?.name, l.status?.color)}
  </div>`;
}

async function draw() {
  const u = me();
  const range = periodRange(period);
  const seller = u.role === 'seller';
  const [s, transferred] = await Promise.all([dashboard.summary(range), seller ? leads.transferredByMe() : []]);
  const maxLeads = Math.max(1, ...(s.sellers || []).map(x => x.leads));
  root.innerHTML = `<div class="toolbar">${periodBar(period)}<div class="grow"></div>
      <span class="muted small">${seller ? 'Faqat sizning mijozlaringiz' : 'Butun markaz bo\'yicha'}</span></div>
    <div class="kpis">
      ${kpi('Leadlar (davr)', num(s.leads), 'var(--accent)', `Jami bazada: ${num(s.totalLeads)}`)}
      ${kpi('Bugungi leadlar', num(s.todayLeads), '#5b8def')}
      ${kpi('Ishlangan', num(s.worked), '#3cc3a6', `Javobsiz: ${num(s.unanswered)}`)}
      ${kpi('Sotuvlar', num(s.won), 'var(--ok)', `Konversiya: ${s.conversion.toFixed(1)}%`)}
      ${kpi('Bekor qilingan', num(s.lost), '#9aa3ab')}
    </div>
    <div class="kpis">
      ${kpi('Tushum (davr)', money(s.revenue), 'var(--ok)', '', true)}
      ${kpi("Kutilayotgan to'lovlar", money(s.expected), 'var(--warn)', '', true)}
      ${kpi('Qarzdorlik', money(s.debt), 'var(--danger)', `${s.debtors.length ? '' : "Qarzdor yo'q"}`, true)}
    </div>
    <div class="grid2">
      <div class="stack">
        ${seller ? '' : `<div class="panel"><div class="panel-head"><h3>Sotuvchilar kesimida</h3><span class="sub">tanlangan davr</span></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sotuvchi</th><th>Bugun</th><th>Leadlar</th><th class="num">Ishlangan</th><th class="num">Sotuv</th><th class="num">Konv.</th><th class="num">Tushum</th></tr></thead><tbody>
          ${s.sellers.map(x => `<tr>
            <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(x.seller.full_name))}</span><b>${esc(x.seller.full_name)}</b></div></td>
            <td>${x.att ? badge(ATT[x.att].name, ATT[x.att].color) : '<span class="muted small">—</span>'}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1"><i style="width:${x.leads / maxLeads * 100}%"></i></div><span>${x.leads}</span></div></td>
            <td class="num">${x.worked}</td><td class="num">${x.won}</td><td class="num">${x.conversion.toFixed(0)}%</td><td class="num">${money(x.revenue)}</td>
          </tr>`).join('')}</tbody></table></div></div>`}
        <div class="panel"><div class="panel-head"><h3>Bugun bog'lanish kerak</h3><span class="sub">${s.callsTotal ?? s.calls.length} ta</span></div>
          ${s.calls.slice(0, 10).map(l => leadRow(l, true)).join('') || '<div class="empty">Rejalashtirilgan qo\'ng\'iroq yo\'q</div>'}</div>
        <div class="panel"><div class="panel-head"><h3>Yangi leadlar</h3><a href="#/leads?view=table" style="margin-left:auto" class="small">Hammasi →</a></div>
          ${s.fresh.map(l => leadRow(l, false)).join('') || '<div class="empty">Yangi lead yo\'q</div>'}</div>
      </div>
      <div class="stack">
        ${seller ? transferredPanel(transferred) : `<div class="panel"><div class="panel-head"><h3>Xodimlar bugun</h3></div>
          ${s.staffToday.map(x => `<div class="list-row"><span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(x.profile.full_name))}</span>
            <div class="grow">${esc(x.profile.full_name)} <span class="muted small">${ROLES[x.profile.role]}</span></div>
            ${x.profile.active ? (x.att ? badge(ATT[x.att].name, ATT[x.att].color) : '<span class="muted small">belgilanmagan</span>') : badge('Nofaol', '#9aa3ab')}</div>`).join('')}</div>`}
        <div class="panel"><div class="panel-head"><h3>Eng katta qarzdorlar</h3><a href="#/payments?status=qarzdor" style="margin-left:auto" class="small">Hammasi →</a></div>
          ${s.debtors.map(p => `<div class="list-row click" data-pay="${p.id}"><div class="grow"><b>${esc(p.lead_name)}</b><div class="small muted">${esc(p.course_name)} · muddat ${fmtDate(p.due)}</div></div><b class="red">${money(p.remaining)}</b></div>`).join('') || '<div class="empty">Qarzdorlik yo\'q</div>'}</div>
      </div>
    </div>`;
}

function transferredPanel(list) {
  return `<div class="panel"><div class="panel-head"><h3>Men yo'naltirgan leadlar</h3><span class="sub">${list.length} ta</span></div>
    ${list.slice(0, 10).map(x => `<div class="list-row"><div class="grow"><b>${esc(x.name)}</b><div class="small muted">${icon('swap').replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${esc(x.to)} · ${fmtDate(x.at)}</div></div>${badge(x.status?.name, x.status?.color)}</div>`).join('') || '<div class="empty">Siz hali lead yo\'naltirmagansiz</div>'}</div>`;
}
