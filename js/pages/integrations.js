// API (faqat FULL ADMIN): Instagram / Facebook reklama formalaridan leadlarni avtomatik qabul qilish.
// Kalitlar faqat serverda saqlanadi — bu sahifa ularni qayta ko'rsatmaydi (faqat oxirgi 4 belgi).
import { integrations } from '../data/api.js';
import { esc, fmtDT, toast, icon, $ } from '../ui.js';

let root;
let timer;

export async function render(el) {
  root = el;
  clearInterval(timer);
  if (!integrations.available) {
    root.innerHTML = `<div class="panel panel-pad"><div class="sec-title">API</div>
      <p class="muted">Instagram integratsiyasi faqat haqiqiy baza (Supabase) ulanganda ishlaydi. Hozir demo rejim.</p></div>`;
    return;
  }
  await draw();
  el.onclick = onClick;
  // sahifa ochiq turganda holat har 30 soniyada yangilanadi
  timer = setInterval(() => { if (document.body.contains(root) && location.hash.startsWith('#/api')) refreshStatus(); else clearInterval(timer); }, 30000);
}

const statusText = s => {
  if (!s.enabled) return '<span class="api-state">O\'chirilgan</span>';
  if (s.last_error) return '<span class="api-state err">Ulangan, lekin xato bor</span>';
  return '<span class="api-state on">Ishlayapti</span>';
};

const evState = e => {
  if (e.status === 'done') return e.duplicate ? '<span class="tag">Takroriy — izoh qo\'shildi</span>' : '<span class="tag" style="background:#e6f7d9;color:#3a7a00">CRMga tushdi</span>';
  if (e.status === 'queued') return `<span class="tag" style="background:#fff1d6;color:#a15c00">Navbatda${e.attempts ? ` (${e.attempts}-urinish)` : ''}</span>`;
  return '<span class="tag" style="background:#ffe9e8;color:#b3261e">Xato</span>';
};

function statsHtml(s) {
  const t = s.stats || {};
  return `<div class="api-stats">
    <div class="api-stat"><b>${t.today ?? 0}</b><span>Bugun kelgan</span></div>
    <div class="api-stat"><b>${t.total ?? 0}</b><span>Jami kelgan</span></div>
    <div class="api-stat ok"><b>${t.done ?? 0}</b><span>Yangi lead bo'ldi</span></div>
    <div class="api-stat"><b>${t.duplicate ?? 0}</b><span>Takroriy raqam</span></div>
    <div class="api-stat wait"><b>${t.queued ?? 0}</b><span>Navbatda</span></div>
    <div class="api-stat bad"><b>${t.failed ?? 0}</b><span>Xato</span></div>
  </div>`;
}

function recentHtml(s) {
  const rows = s.recent || [];
  if (!rows.length) return '<div class="empty">Hali Instagram/Facebook\'dan lead kelmagan</div>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kelgan vaqt</th><th>Mijoz</th><th>Telefon</th><th>Manba</th><th>Holat</th></tr></thead><tbody>
    ${rows.map(e => `<tr ${e.lead_id ? `class="click" data-lead="${e.lead_id}"` : ''}>
      <td class="nowrap">${fmtDT(e.received_at)}</td>
      <td>${esc(e.lead_name || '—')}${e.error ? `<div class="small red">${esc(e.error)}</div>` : ''}</td>
      <td class="nowrap">${esc(e.phone || '')}</td>
      <td class="nowrap">${e.platform === 'fb' ? 'Facebook' : e.platform === 'ig' ? 'Instagram' : '—'} · ${e.via === 'sync' ? 'sinxron' : 'webhook'}</td>
      <td>${evState(e)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

async function draw() {
  let s;
  try { s = await integrations.metaStatus(); } catch (ex) { root.innerHTML = `<div class="api-err">${esc(ex.message)}</div>`; return; }
  const url = integrations.webhookUrl;
  root.innerHTML = `<div class="grid2">
    <div class="stack">
      <div class="panel panel-pad">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div class="sec-title" style="margin:0;flex:1">Instagram / Facebook reklama formalari</div>
          <span data-state>${statusText(s)}</span>
        </div>
        ${s.page_name ? `<p class="small" style="margin:0 0 8px">Sahifa: <b>${esc(s.page_name)}</b></p>` : ''}
        <p class="small muted" style="margin:0 0 10px">Oxirgi tekshiruv: ${fmtDT(s.last_sync_at) || '—'} · Oxirgi muvaffaqiyat: ${fmtDT(s.last_ok_at) || '—'}</p>
        <div data-lasterr>${s.last_error ? `<div class="api-err">${esc(s.last_error)}</div>` : ''}</div>
        <div data-stats style="margin-top:12px">${statsHtml(s)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn" data-act="test">${icon('link')} Ulanishni tekshirish</button>
          <button class="btn" data-act="sync">Hozir sinxronlash</button>
          ${(s.stats?.failed ?? 0) ? '<button class="btn light" data-act="retry">Xatolarni qayta urinish</button>' : ''}
        </div>
        <div data-testres style="margin-top:10px"></div>
      </div>
      <div class="panel panel-pad"><div class="sec-title">Oxirgi kelgan leadlar</div><div data-recent>${recentHtml(s)}</div></div>
    </div>

    <div class="stack">
      <form class="panel panel-pad stack" data-form autocomplete="off">
        <div class="sec-title" style="margin:0">Kalitlar</div>
        <div class="fld"><label class="req">Facebook sahifa ID (Page ID)</label><input class="inp" name="page_id" value="${esc(s.page_id || '')}" placeholder="Masalan: 102938475610293"></div>
        <div class="fld"><label class="req">Page Access Token</label>
          <input class="inp" name="page_token" type="password" placeholder="${s.token_tail ? `Saqlangan: ••••${esc(s.token_tail)} (o'zgartirish uchun yangisini qo'ying)` : 'EAAG... bilan boshlanadi'}"></div>
        <div class="fld"><label class="req">App Secret</label>
          <input class="inp" name="app_secret" type="password" placeholder="${s.has_app_secret ? "Saqlangan (o'zgartirish uchun yangisini qo'ying)" : 'Meta ilova sozlamalaridan'}"></div>
        <details><summary class="small muted" style="cursor:pointer">Qo'shimcha</summary>
          <div class="fld" style="margin-top:8px"><label>Graph API versiyasi</label><input class="inp" name="graph_version" value="${esc(s.graph_version || 'v23.0')}"></div>
        </details>
        <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Leadlarni qabul qilish yoqilgan</label>
        <div><button class="btn primary" type="submit">Saqlash</button></div>
        <p class="small muted" style="margin:0">Kalitlar faqat serverda saqlanadi va bu sahifada qayta ko'rsatilmaydi.</p>
      </form>

      <div class="panel panel-pad stack">
        <div class="sec-title" style="margin:0">Meta webhook sozlamasi</div>
        <div class="fld"><label>Callback URL</label><div class="copy-row"><input class="inp" readonly value="${esc(url)}"><button type="button" class="btn sm" data-copy="${esc(url)}">Nusxa</button></div></div>
        <div class="fld"><label>Verify token</label><div class="copy-row"><input class="inp" readonly value="${esc(s.verify_token || "Avval «Saqlash» ni bosing")}">${s.verify_token ? `<button type="button" class="btn sm" data-copy="${esc(s.verify_token)}">Nusxa</button>` : ''}</div></div>
        <ol class="api-steps">
          <li><b>developers.facebook.com</b> → ilova yarating (turi: Business) va <b>Webhooks</b> mahsulotini qo'shing.</li>
          <li>Webhooks → <b>Page</b> → yuqoridagi Callback URL va Verify token ni kiriting → <b>leadgen</b> maydoniga obuna bo'ling.</li>
          <li>Ilova sozlamalaridan <b>App Secret</b> ni, Instagram ulangan Facebook sahifangizdan <b>Page ID</b> ni oling.</li>
          <li><b>Page Access Token</b> — muddatsiz bo'lishi uchun Business Settings → System users orqali yarating. Ruxsatlar: <i>leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads</i>.</li>
          <li>Shu yerga kiriting, «Leadlarni qabul qilish» ni yoqib saqlang va <b>«Ulanishni tekshirish»</b> ni bosing.</li>
          <li>Sinab ko'rish: <b>Lead Ads Testing Tool</b> orqali sinov lead yuboring — bir necha soniyada shu yerda paydo bo'ladi.</li>
        </ol>
      </div>
    </div>
  </div>`;

  $('[data-form]', root).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await integrations.metaSave({
        page_id: f.page_id.value.trim(), page_token: f.page_token.value.trim(), app_secret: f.app_secret.value.trim(),
        graph_version: f.graph_version.value.trim(), enabled: f.enabled.checked,
      });
      toast('Saqlandi');
      await draw();
    } catch (ex) { toast(ex.message, 'err'); }
  };
}

async function refreshStatus() {
  try {
    const s = await integrations.metaStatus();
    const set = (sel, html) => { const n = $(sel, root); if (n) n.innerHTML = html; };
    set('[data-state]', statusText(s));
    set('[data-stats]', statsHtml(s));
    set('[data-recent]', recentHtml(s));
    set('[data-lasterr]', s.last_error ? `<div class="api-err">${esc(s.last_error)}</div>` : '');
  } catch { /* keyingi safar */ }
}

async function onClick(e) {
  const cp = e.target.closest('[data-copy]');
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); return toast('Nusxa olindi'); }
  const lead = e.target.closest('[data-lead]');
  if (lead) { location.hash = `#/leads?open=${lead.dataset.lead}`; return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const btn = e.target.closest('button');
  btn.disabled = true;
  try {
    if (act === 'test') {
      const r = await integrations.metaTest();
      $('[data-testres]', root).innerHTML = r.ok
        ? `<div class="small" style="background:#e6f7d9;border-radius:6px;padding:8px 10px">✅ Ulandi: <b>${esc(r.page_name)}</b> · webhook obunasi: ${r.subscribed ? 'faol' : '<b>yo\'q</b>'} · formalar: ${r.forms.length}
            ${r.forms.length ? `<div class="muted">${r.forms.map(f => esc(f.name)).join(', ')}</div>` : ''}
            ${(r.warnings || []).map(w => `<div class="red">⚠️ ${esc(w)}</div>`).join('')}</div>`
        : `<div class="api-err">❌ ${esc(r.error)}</div>`;
    }
    if (act === 'sync') {
      const r = await integrations.metaSync();
      if (r.skipped) toast('Avval kalitlarni kiritib, qabul qilishni yoqing', 'err');
      else if (r.sync_error) toast(r.sync_error, 'err');
      else toast(`Sinxronlandi: yangi topilgan ${r.synced ?? 0}, CRMga o'tkazildi ${r.queue?.ok ?? 0}`);
    }
    if (act === 'retry') { const n = await integrations.metaRetry(); toast(`${n} ta qayta navbatga qo'yildi`); }
    await draw();
  } catch (ex) { toast(ex.message, 'err'); } finally { if (btn.isConnected) btn.disabled = false; }
}
