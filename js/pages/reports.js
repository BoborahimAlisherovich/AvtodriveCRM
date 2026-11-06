// Hisobotlar: sotuvchilar samaradorligi (kunlik, haftalik, oylik, oraliq).
import { reports } from '../data/api.js';
import { esc, money, periodBar, periodRange, handlePeriod, icon, toast } from '../ui.js';
import { exportExcel } from '../excel.js';

const period = { kind: 'month', from: '', to: '' };
let root;

const COLS = [
  ['received', 'Qabul qilingan', 'Sotuvchiga biriktirilgan leadlar'],
  ['worked', 'Ishlangan', 'Aloqa qilingan mijozlar'],
  ['unanswered', 'Javobsiz', "Aloqa o'rnatilmagan"],
  ['won', 'Sotuvlar', 'Kursga yozilganlar'],
  ['conversion', 'Konversiya', 'Sotuvga aylanish foizi'],
  ['sentOut', "Yo'naltirgan", "Boshqa sotuvchiga o'tkazganlari"],
  ['receivedIn', 'Qabul qilgan yo\'naltirma', 'Boshqa sotuvchidan kelganlar'],
  ['revenue', 'Tushum', "Mijozlaridan tushgan to'lovlar"],
];

export function render(el) {
  root = el;
  draw();
  const onP = e => { const c = handlePeriod(e, period); if (c) draw(); return c; };
  el.onclick = e => { if (onP(e)) return; if (e.target.closest('[data-export]')) doExport(); };
  el.onchange = onP;
}

const fmt = (k, v) => (k === 'revenue' ? money(v) : k === 'conversion' ? v.toFixed(1) + '%' : v);

async function draw() {
  const rows = await reports.sellers(periodRange(period));
  const tot = Object.fromEntries(COLS.map(([k]) => [k, rows.reduce((s, r) => s + r[k], 0)]));
  const leadsSum = rows.reduce((s, r) => s + r.leads, 0);
  tot.conversion = leadsSum ? tot.won / leadsSum * 100 : 0;
  const best = Math.max(...rows.map(r => r.conversion), 1);
  root.innerHTML = `<div class="toolbar">${periodBar(period)}<div class="grow"></div><button class="btn" data-export>${icon('excel')} Excel</button></div>
    <div class="panel"><div class="panel-head"><h3>Sotuvchilar statistikasi</h3><span class="sub">ustun nomiga sichqonchani olib boring — izoh chiqadi</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sotuvchi</th>${COLS.map(([, t, d]) => `<th class="num" title="${esc(d)}">${t}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr><td><b>${esc(r.seller.full_name)}</b>${r.seller.active ? '' : ' <span class="muted small">(nofaol)</span>'}</td>
      ${COLS.map(([k]) => `<td class="num">${k === 'conversion' ? `<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end"><div class="bar" style="width:60px"><i style="width:${r.conversion / best * 100}%;background:var(--ok)"></i></div>${fmt(k, r[k])}</div>` : fmt(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td>Jami</td>${COLS.map(([k]) => `<td class="num">${fmt(k, tot[k])}</td>`).join('')}</tr></tfoot></table></div></div>
    <p class="muted small">Ishlangan/javobsiz/sotuv ko'rsatkichlari tanlangan davrda kelgan va hozir sotuvchiga biriktirilgan leadlar bo'yicha hisoblanadi. Tushum — davr ichida qabul qilingan to'lovlar.</p>`;
}

async function doExport() {
  const r = periodRange(period);
  try {
    await exportExcel(`hisobot_${r.from || 'boshidan'}_${r.to || 'hozirgacha'}.xlsx`, [{
      name: 'Sotuvchilar',
      rows: (await reports.sellers(r)).map(x => ({ 'Sotuvchi': x.seller.full_name, ...Object.fromEntries(COLS.map(([k, t]) => [t, k === 'conversion' ? Number(x[k].toFixed(1)) : x[k]])) })),
    }]);
  } catch (ex) { toast(ex.message, 'err'); }
}
