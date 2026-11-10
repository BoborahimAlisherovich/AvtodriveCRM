// Davomat: kunlik belgilash — holat, kelish va ketish vaqti (faqat FULL ADMIN).
// Hisobot: hafta / oy / yil / oraliq — kelgan kunlar, kechikishlar, ishlagan soatlar. ROOP faqat ko'radi.
import { attendance, ATT, today, ymd, workedMinutes, hhmm } from '../data/api.js';
import { can, ROLES } from '../auth.js';
import { esc, badge, toast, initials, fmtDate } from '../ui.js';
import { exportExcel } from '../excel.js';

const st = { date: today(), period: 'month', from: '', to: '' };
let root;

export function render(el) {
  root = el;
  draw();
  el.onclick = onClick;
  el.onchange = onChange;
}

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function shift(days) { const d = parse(st.date); d.setDate(d.getDate() + days); st.date = ymd(d); }

// Tanlangan sanaga qarab davr chegaralari
function range() {
  const d = parse(st.date);
  if (st.period === 'week') {
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return [ymd(mon), ymd(sun), `Hafta: ${fmtDate(ymd(mon))} – ${fmtDate(ymd(sun))}`];
  }
  if (st.period === 'year') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`, `${d.getFullYear()}-yil`];
  if (st.period === 'custom') {
    const f = st.from || ymd(new Date(d.getFullYear(), d.getMonth(), 1)), t = st.to || st.date;
    return [f, t, `${fmtDate(f)} – ${fmtDate(t)}`];
  }
  const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
  return [ymd(first), ymd(last), `${MONTHS[d.getMonth()]} ${d.getFullYear()}`];
}

function dayRow(r, edit) {
  const pid = r.profile.id;
  const worked = workedMinutes(r);
  const isToday = st.date === today();
  const timeFld = (k, label) => `<label class="att-time"><span>${label}</span>
      <input class="inp" type="time" data-time="${k}" data-pid="${pid}" value="${esc(r[k] || '')}" ${edit ? '' : 'disabled'}>
      ${edit && isToday && !r[k] ? `<button type="button" class="btn sm light" data-now="${k}" data-pid="${pid}">Hozir</button>` : ''}</label>`;
  return `<div class="list-row att-row">
    <span class="avatar">${esc(initials(r.profile.full_name))}</span>
    <div class="grow"><b>${esc(r.profile.full_name)}</b> ${r.profile.active ? '' : badge('Nofaol', '#9aa3ab')}
      <div class="small muted">${ROLES[r.profile.role]} · ish vaqti ${esc(r.profile.work_start)}–${esc(r.profile.work_end)}${r.in_rr ? ' · <span class="green">lead navbatida</span>' : ''}</div></div>
    ${edit ? `<div class="seg">${Object.entries(ATT).map(([k, v]) => `<button data-set="${k}" data-pid="${pid}" class="${r.status === k ? 'on' : ''}" title="${v.name}" style="${r.status === k ? `box-shadow:inset 0 -3px 0 ${v.color}` : ''}">${v.name.split(' ')[0]}</button>`).join('')}</div>`
      : (r.status ? badge(ATT[r.status].name, ATT[r.status].color) : '<span class="muted small">belgilanmagan</span>')}
    <div class="att-times">${timeFld('time_in', 'Keldi')}${timeFld('time_out', 'Ketdi')}
      <span class="att-worked ${worked ? '' : 'muted'}">${worked ? hhmm(worked) : '—'}</span></div>
  </div>`;
}

async function draw() {
  const edit = can('attendance.edit');
  const [from, to, label] = range();
  const [rows, rep] = await Promise.all([attendance.day(st.date), attendance.report(from, to)]);
  const list = rep.filter(r => r.profile.active || r.came || r.minutes);
  const sum = list.reduce((a, r) => a + r.minutes, 0);
  root.innerHTML = `<div class="toolbar">
      <button class="btn sm" data-shift="-1">‹</button>
      <input class="inp" type="date" data-date value="${st.date}">
      <button class="btn sm" data-shift="1">›</button>
      ${st.date !== today() ? `<button class="btn light sm" data-today>Bugun</button>` : ''}
      <div class="grow"></div>
      ${edit ? '' : '<span class="muted small">Faqat ko\'rish rejimi</span>'}
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h3>${fmtDate(st.date)}</h3><span class="sub">kunlik davomat${edit ? ' · vaqtni kiritsangiz holat o\'zi belgilanadi (kech kelsa — «Kechikdi»)' : ''}</span></div>
        ${rows.map(r => dayRow(r, edit)).join('')}
      </div>
      <div class="panel">
        <div class="panel-head" style="flex-wrap:wrap;gap:8px"><h3>Hisobot</h3><span class="sub">${esc(label)}</span><div class="grow"></div>
          <div class="seg">${[['week', 'Hafta'], ['month', 'Oy'], ['year', 'Yil'], ['custom', 'Oraliq']].map(([k, v]) => `<button data-period="${k}" class="${st.period === k ? 'on' : ''}">${v}</button>`).join('')}</div>
          ${st.period === 'custom' ? `<input class="inp" type="date" data-from value="${esc(from)}"><input class="inp" type="date" data-to value="${esc(to)}">` : ''}
          <button class="btn sm" data-export>Excel</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>Xodim</th><th class="num">Kelgan kun</th><th class="num">Kechikdi</th><th class="num">Kelmadi</th><th class="num">Ruxsat</th><th class="num">Dam</th><th class="num">Jami ishlagan</th><th class="num">O'rtacha / kun</th>
        </tr></thead><tbody>
        ${list.map(r => `<tr><td class="nowrap"><b>${esc(r.profile.full_name)}</b></td>
          <td class="num">${r.came}</td><td class="num ${r.kechikdi ? 'red' : ''}">${r.kechikdi || ''}</td><td class="num">${r.kelmadi || ''}</td>
          <td class="num">${r.ruxsat || ''}</td><td class="num">${r.dam || ''}</td>
          <td class="num nowrap"><b>${r.minutes ? hhmm(r.minutes) : '—'}</b></td><td class="num nowrap">${r.avg ? hhmm(r.avg) : '—'}</td></tr>`).join('')}
        </tbody>${list.length ? `<tfoot><tr><td><b>Jami</b></td><td class="num">${list.reduce((a, r) => a + r.came, 0)}</td><td class="num">${list.reduce((a, r) => a + r.kechikdi, 0) || ''}</td><td class="num">${list.reduce((a, r) => a + r.kelmadi, 0) || ''}</td><td class="num">${list.reduce((a, r) => a + r.ruxsat, 0) || ''}</td><td class="num">${list.reduce((a, r) => a + r.dam, 0) || ''}</td><td class="num nowrap"><b>${sum ? hhmm(sum) : '—'}</b></td><td></td></tr></tfoot>` : ''}</table></div>
        ${list.length ? '' : '<div class="empty">Bu davrda davomat yo\'q</div>'}
        <p class="small muted" style="padding:0 16px 12px;margin:0">Ishlagan vaqt kelish va ketish vaqti kiritilgan kunlar bo'yicha hisoblanadi.</p>
      </div>
    </div>
    <p class="muted small">Ishga kelmagan, ruxsat bilan yo'q yoki dam olish kunidagi sotuvchiga yangi lead taqsimlanmaydi. Xodim "Ishda" yoki "Kechikdi" deb belgilanganda navbatga qaytadi.</p>`;
}

async function saveRow(pid, patch) {
  const row = root.querySelector(`[data-pid="${pid}"]`)?.closest('.att-row');
  const val = k => row?.querySelector(`[data-time="${k}"]`)?.value || '';
  try {
    await attendance.save(pid, st.date, { time_in: val('time_in'), time_out: val('time_out'), ...patch });
    toast('Saqlandi');
  } catch (ex) { toast(ex.message, 'err'); }
  draw();
}

async function onClick(e) {
  const sh = e.target.closest('[data-shift]');
  if (sh) { shift(Number(sh.dataset.shift)); return draw(); }
  if (e.target.closest('[data-today]')) { st.date = today(); return draw(); }
  const per = e.target.closest('[data-period]');
  if (per) { st.period = per.dataset.period; return draw(); }
  const set = e.target.closest('[data-set]');
  if (set) return saveRow(set.dataset.pid, { status: set.dataset.set });
  const now = e.target.closest('[data-now]');
  if (now) {
    const d = new Date();
    const inp = now.parentElement.querySelector('input');
    inp.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return saveRow(now.dataset.pid, {});
  }
  if (e.target.closest('[data-export]')) {
    const [from, to, label] = range();
    try {
      const rep = (await attendance.report(from, to)).filter(r => r.profile.active || r.came || r.minutes);
      await exportExcel(`davomat_${from}_${to}.xlsx`, [{
        name: 'Davomat',
        rows: rep.map(r => ({
          'Xodim': r.profile.full_name, 'Rol': ROLES[r.profile.role], 'Davr': label, 'Kelgan kun': r.came, 'Kechikdi': r.kechikdi,
          'Kelmadi': r.kelmadi, 'Ruxsat': r.ruxsat, 'Dam': r.dam, 'Jami ishlagan (soat)': +(r.minutes / 60).toFixed(1),
          "O'rtacha kunlik (soat)": +(r.avg / 60).toFixed(1),
        })),
      }]);
    } catch (ex) { toast(ex.message, 'err'); }
  }
}

function onChange(e) {
  if (e.target.matches('[data-date]') && e.target.value) { st.date = e.target.value; return draw(); }
  if (e.target.matches('[data-from]')) { st.from = e.target.value; return draw(); }
  if (e.target.matches('[data-to]')) { st.to = e.target.value; return draw(); }
  if (e.target.matches('[data-time]')) return saveRow(e.target.dataset.pid, {});
}
