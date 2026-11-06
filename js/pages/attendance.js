// Davomat: kunlik belgilash (FULL ADMIN) va oylik jamlanma. ROOP faqat ko'radi.
import { attendance, ATT, today, ymd } from '../data/api.js';
import { can, ROLES } from '../auth.js';
import { esc, badge, toast, initials, fmtDate } from '../ui.js';
import { exportExcel } from '../excel.js';

const st = { date: today() };
let root;

export function render(el) {
  root = el;
  draw();
  el.onclick = onClick;
  el.onchange = onChange;
}

function shift(days) {
  const [y, m, d] = st.date.split('-').map(Number);
  st.date = ymd(new Date(y, m - 1, d + days));
}

async function draw() {
  const edit = can('attendance.edit');
  const rows = await attendance.day(st.date);
  const ym = st.date.slice(0, 7);
  const month = await attendance.month(ym);
  root.innerHTML = `<div class="toolbar">
      <button class="btn sm" data-shift="-1">‹</button>
      <input class="inp" type="date" data-date value="${st.date}">
      <button class="btn sm" data-shift="1">›</button>
      ${st.date !== today() ? `<button class="btn light sm" data-today>Bugun</button>` : ''}
      <div class="grow"></div>
      ${edit ? '' : '<span class="muted small">Faqat ko\'rish rejimi</span>'}
      <button class="btn" data-export>Excel</button>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h3>${fmtDate(st.date)}</h3><span class="sub">kunlik davomat</span></div>
        ${rows.map(r => `<div class="list-row">
          <span class="avatar">${esc(initials(r.profile.full_name))}</span>
          <div class="grow"><b>${esc(r.profile.full_name)}</b> ${r.profile.active ? '' : badge('Nofaol', '#9aa3ab')}
            <div class="small muted">${ROLES[r.profile.role]} · ${esc(r.profile.work_start)}${r.in_rr ? ' · <span class="green">lead navbatida</span>' : ''}</div></div>
          ${edit ? `<div class="seg">${Object.entries(ATT).map(([k, v]) => `<button data-set="${k}" data-pid="${r.profile.id}" class="${r.status === k ? 'on' : ''}" title="${v.name}" style="${r.status === k ? `box-shadow:inset 0 -3px 0 ${v.color}` : ''}">${v.name.split(' ')[0]}</button>`).join('')}</div>`
            : (r.status ? badge(ATT[r.status].name, ATT[r.status].color) : '<span class="muted small">belgilanmagan</span>')}
        </div>`).join('')}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Oylik jamlanma</h3><span class="sub">${ym}</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Xodim</th>${Object.values(ATT).map(v => `<th class="num" title="${v.name}">${badge(v.name.split(' ')[0], v.color, 'plain')}</th>`).join('')}</tr></thead>
        <tbody>${month.map(m => `<tr><td>${esc(m.profile.full_name)}</td>${Object.keys(ATT).map(k => `<td class="num">${m[k] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    <p class="muted small">Ishga kelmagan, ruxsat bilan yo'q yoki dam olish kunidagi sotuvchiga yangi lead taqsimlanmaydi. Xodim "Ishda" yoki "Kechikdi" deb belgilanganda navbatga qaytadi.</p>`;
}

async function onClick(e) {
  const sh = e.target.closest('[data-shift]');
  if (sh) { shift(Number(sh.dataset.shift)); return draw(); }
  if (e.target.closest('[data-today]')) { st.date = today(); return draw(); }
  const set = e.target.closest('[data-set]');
  if (set) {
    try { await attendance.set(set.dataset.pid, st.date, set.dataset.set); toast(ATT[set.dataset.set].name); draw(); } catch (ex) { toast(ex.message, 'err'); }
  }
  if (e.target.closest('[data-export]')) {
    const ym = st.date.slice(0, 7);
    try {
      await exportExcel(`davomat_${ym}.xlsx`, [{
        name: `Davomat ${ym}`,
        rows: (await attendance.month(ym)).map(m => ({ 'Xodim': m.profile.full_name, 'Rol': ROLES[m.profile.role], ...Object.fromEntries(Object.entries(ATT).map(([k, v]) => [v.name, m[k]])) })),
      }]);
    } catch (ex) { toast(ex.message, 'err'); }
  }
}

function onChange(e) {
  if (e.target.matches('[data-date]') && e.target.value) { st.date = e.target.value; draw(); }
}
