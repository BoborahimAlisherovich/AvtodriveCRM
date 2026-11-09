// Telegram: xabarnomalar tarixi va mijozni botga ulash tartibi.
import { telegram, settings, mode } from '../data/api.js';
import { esc, fmtDT, options, badge } from '../ui.js';

const st = { status: '', audience: '' };
const STATUS = { sent: ['Yuborildi', '#7bd500'], queued: ['Navbatda', '#ffa900'], failed: ['Xato', '#ff5752'] };
const AUD = { staff: 'Xodim', client: 'Mijoz' };
let root;

export async function render(el) {
  root = el;
  await draw();
  el.onchange = e => { const f = e.target.dataset.f; if (f) { st[f] = e.target.value; draw(); } };
}

async function draw() {
  const rows = await telegram.notifications(st);
  const bot = settings.get().bot_username;
  root.innerHTML = `<div class="grid2">
    <div class="panel">
      <div class="panel-head"><h3>Xabarnomalar tarixi</h3><div class="grow"></div>
        <select class="sel" data-f="audience">${options(Object.entries(AUD), st.audience, { empty: 'Hammasi' })}</select>
        <select class="sel" data-f="status">${options(Object.entries(STATUS).map(([k, v]) => [k, v[0]]), st.status, { empty: 'Barcha holatlar' })}</select></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vaqt</th><th>Kimga</th><th>Xabar</th><th>Holat</th><th class="num">Urinish</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="nowrap">${fmtDT(r.created_at)}</td><td class="nowrap">${esc(r.recipient)} <span class="tag">${AUD[r.audience]}</span></td>
          <td>${esc(r.text)}${r.error ? `<div class="small red">${esc(r.error)}</div>` : ''}</td><td>${badge(...STATUS[r.status])}</td><td class="num">${r.attempts}</td></tr>`).join('')}
      </tbody></table></div>
      ${rows.length ? '' : '<div class="empty">Xabar yo\'q</div>'}
    </div>
    <div class="stack">
      <div class="panel panel-pad"><div class="sec-title">Bot</div>
        <div>@${esc(bot)} ${mode === 'demo' ? badge('Ulanmagan (demo)', '#ffa900') : badge('Ishlayapti', '#7bd500')}</div>
        <p class="small muted">"Navbatda" xabarlar har daqiqada avtomatik yuboriladi. Xatolar va qayta urinishlar shu yerda ko'rinadi.</p></div>
      <div class="info"><b>Mijozni botga ulash</b><ol>
        <li>Lead kartasida "Havola yaratish" bosiladi.</li>
        <li>CRM bir martalik, 24 soatlik token yaratadi (bazada faqat hash saqlanadi).</li>
        <li>Mijoz <code>t.me/${esc(bot)}?start=TOKEN</code> havolasini ochib START bosadi.</li>
        <li>Bot tokenni tekshiradi va mijozning chat_id sini CRMga bog'laydi. Token yaroqsiz bo'ladi.</li></ol></div>
      <div class="panel panel-pad"><div class="sec-title">Avtomatik xabarlar</div>
        <div class="small"><b>Mijozlarga:</b> to'lov muddati yaqinlashgani, qarzdorlik, to'lov qabul qilingani, tug'ilgan kun tabrigi, lead kartasidan yozilgan xabarlar.</div>
        <div class="small" style="margin-top:6px"><b>Xodimlarga:</b> yangi lead, lead o'tkazilishi, kunlik natijalar, mijoz tug'ilgan kuni (bir kun oldin va o'sha kuni).</div>
        <div class="small" style="margin-top:6px"><b>FULL ADMIN va ROOPga:</b> qarzdorlik, leadlar va sotuvchilar hisoboti.</div></div>
    </div></div>`;
}
