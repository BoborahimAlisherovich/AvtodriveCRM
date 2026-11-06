// Leadlar: Kanban va jadval ko'rinishi, qidiruv, filtrlar, ommaviy o'tkazish, Excel.
import { leads, stages, courses, staff, settings, PAY_STATUS, today } from '../data/api.js';
import { can } from '../auth.js';
import { esc, fmtDate, fmtDT, fmtPhone, options, badge, icon, toast, debounce, modal, pager, $, $$ } from '../ui.js';
import { openLead, newLeadModal, transferModal } from '../components/leadCard.js';
import { createPaymentModal } from '../components/payForms.js';
import { exportExcel, readExcel, guessMapping, applyMapping, IMPORT_FIELDS } from '../excel.js';

const st = { view: 'kanban', q: '', owner: '', status: '', source: '', course: '', pay: '', from: '', to: '', page: 1, size: 50, limits: {}, sel: new Set() };
let root;

const filters = () => ({ q: st.q, owner: st.owner, status: st.status, source: st.source, course: st.course, pay: st.pay, from: st.from, to: st.to });
const changed = () => dispatchEvent(new Event('crm:changed'));

export async function render(el, params) {
  root = el;
  if (params.q !== undefined) { st.q = params.q; st.page = 1; }
  if (params.view) st.view = params.view;
  if (params.owner !== undefined) st.owner = params.owner;
  drawToolbar();
  await drawBody();
  el.onclick = onClick;
  el.oninput = onInput;
  el.onchange = onChange;
  if (params.open) openLead(params.open, refresh);
}

function drawToolbar() {
  const all = can('leads.all');
  const sellers = staff.sellers();
  const src = settings.get().sources;
  const anyFilter = st.owner || st.status || st.source || st.course || st.pay || st.from || st.to || st.q;
  root.innerHTML = `<div class="toolbar">
      <div class="seg"><button data-view="kanban" class="${st.view === 'kanban' ? 'on' : ''}">${icon('kanban')} Kanban</button><button data-view="table" class="${st.view === 'table' ? 'on' : ''}">${icon('table')} Jadval</button></div>
      <div class="search">${icon('search')}<input class="inp" data-f="q" type="search" placeholder="Ism, familiya yoki telefon" value="${esc(st.q)}"></div>
      ${all ? `<select class="sel" data-f="owner">${options([['none', 'Biriktirilmagan'], ...sellers.map(s => [s.id, s.full_name])], st.owner, { empty: 'Barcha sotuvchilar' })}</select>` : ''}
      ${st.view === 'table' ? `<select class="sel" data-f="status">${options(stages.list().map(s => [s.id, s.name]), st.status, { empty: 'Barcha statuslar' })}</select>` : ''}
      <select class="sel" data-f="source">${options(src, st.source, { empty: 'Barcha manbalar' })}</select>
      <select class="sel" data-f="course">${options(courses.list({ includeInactive: true }).map(c => [c.id, c.name]), st.course, { empty: 'Barcha kurslar' })}</select>
      <select class="sel" data-f="pay">${options([['none', "To'lov yo'q"], ...Object.entries(PAY_STATUS).filter(([k]) => k !== 'bekor').map(([k, v]) => [k, v.name])], st.pay, { empty: "To'lov holati" })}</select>
      <input class="inp" type="date" data-f="from" value="${esc(st.from)}" title="Sanadan"><input class="inp" type="date" data-f="to" value="${esc(st.to)}" title="Sanagacha">
      ${anyFilter ? `<button class="btn light sm" data-act="clear">Tozalash</button>` : ''}
      <div class="grow"></div>
      ${can('leads.import') ? `<button class="btn" data-act="import" title="Excel'dan yuklash">${icon('upload')} Import</button>` : ''}
      <button class="btn" data-act="export" title="Excel'ga yuklab olish">${icon('excel')} Excel</button>
    </div><div data-body></div>`;
}

async function drawBody() {
  const body = $('[data-body]', root);
  if (st.view === 'kanban') body.innerHTML = await kanbanHtml();
  else body.innerHTML = await tableHtml();
  if (st.view === 'kanban') bindDnD(body);
}

async function refresh() { await drawBody(); }

/* ---------------- Kanban ---------------- */
function card(l) {
  const t = Date.now();
  const due = l.next_contact_at ? new Date(l.next_contact_at) : null;
  const late = due && due.getTime() < t;
  const isToday = due && fmtDate(l.next_contact_at) === fmtDate(new Date().toISOString());
  return `<article class="kcard" draggable="true" data-id="${l.id}" style="--c:${esc(l.status?.color)}">
    <div class="kc-name">${esc(l.name)}</div>
    <div class="kc-phone">${esc(fmtPhone(l.phone))}</div>
    <div class="kc-meta">${[l.course_name, can('leads.all') ? l.owner_name || 'biriktirilmagan' : ''].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="kc-foot"><span>${esc(l.source)} · ${fmtDate(l.created_at)}</span>
      ${due ? `<span class="due ${late ? 'late' : ''}" title="Keyingi aloqa">${isToday ? 'Bugun ' + fmtDT(l.next_contact_at).slice(11) : fmtDT(l.next_contact_at).slice(0, 16)}</span>` : ''}
      ${l.pay_status ? badge(PAY_STATUS[l.pay_status].name, PAY_STATUS[l.pay_status].color, 'plain') : ''}</div>
  </article>`;
}

async function kanbanHtml() {
  const cols = await leads.kanban(filters(), st.limits);
  const manage = can('stages.manage');
  return `<div class="kanban">${cols.map(c => `<section class="kcol">
      <header class="khead" style="--c:${esc(c.stage.color)}"><span class="kname" title="${esc(c.stage.name)}">${esc(c.stage.name)}</span><span class="kcount">${c.total}</span>
        ${manage ? `<button class="icon-btn" data-stage="${c.stage.id}" title="Bosqichni tahrirlash">${icon('dots')}</button>` : ''}</header>
      <div class="kbody" data-drop="${c.stage.id}">${c.rows.map(card).join('')}
        ${c.total > c.rows.length ? `<button class="btn sm light kmore" data-more="${c.stage.id}">Yana ko'rsatish (${c.total - c.rows.length})</button>` : ''}
        ${!c.total ? '<div class="muted small" style="text-align:center;padding:14px 0">Bo\'sh</div>' : ''}</div>
    </section>`).join('')}
    ${manage ? `<button class="kadd" data-act="addstage">+ Bosqich qo'shish</button>` : ''}</div>`;
}

function bindDnD(body) {
  let dragId = null;
  body.addEventListener('dragstart', e => {
    const c = e.target.closest('.kcard');
    if (!c) return;
    dragId = c.dataset.id;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  body.addEventListener('dragend', e => { e.target.closest('.kcard')?.classList.remove('dragging'); $$('.kbody.over', body).forEach(x => x.classList.remove('over')); });
  body.addEventListener('dragover', e => {
    const zone = e.target.closest('[data-drop]');
    if (!zone || !dragId) return;
    e.preventDefault();
    $$('.kbody.over', body).forEach(x => x !== zone && x.classList.remove('over'));
    zone.classList.add('over');
  });
  body.addEventListener('drop', async e => {
    const zone = e.target.closest('[data-drop]');
    if (!zone || !dragId) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    const stage = stages.get(zone.dataset.drop);
    try {
      const before = (await leads.get(id));
      await leads.setStatus(id, stage.id);
      changed();
      await refresh();
      if (stage.kind === 'won' && !before.payments.length && can('payments.create')) {
        createPaymentModal({ leadId: id, onDone: refresh });
      }
    } catch (ex) { toast(ex.message, 'err'); refresh(); }
  });
}

async function stageMenu(id) {
  const s = stages.get(id);
  const r = await modal({
    title: 'Bosqichni tahrirlash',
    body: `<div class="form-grid">
      <div class="fld full"><label>Nomi</label><input class="inp" name="name" value="${esc(s.name)}"></div>
      <div class="fld"><label>Rangi</label><input class="inp" type="color" name="color" value="${esc(s.color)}" style="width:80px;padding:2px"></div>
      <div class="fld"><label>Joyi</label><div style="display:flex;gap:6px"><button type="button" class="btn sm" data-move="-1">← Chapga</button><button type="button" class="btn sm" data-move="1">O'ngga →</button></div></div>
      ${s.is_system ? '<div class="fld full muted small">Bu tizim bosqichi (statistika uchun kerak) — o\'chirib bo\'lmaydi.</div>' : '<div class="fld full"><button type="button" class="btn danger sm" data-del>Bosqichni o\'chirish</button></div>'}
    </div>`,
    onMount(form) {
      form.addEventListener('click', async e => {
        const mv = e.target.closest('[data-move]');
        if (mv) { await stages.move(id, Number(mv.dataset.move)); refresh(); toast('Joyi o\'zgardi'); }
        if (e.target.closest('[data-del]')) {
          try { await stages.remove(id); toast("Bosqich o'chirildi"); form.parentElement.querySelector('[data-close]').click(); refresh(); } catch (ex) { toast(ex.message, 'err'); }
        }
      });
    },
    onSubmit: v => stages.update(id, v),
  });
  if (r) refresh();
}

async function addStage() {
  const r = await modal({
    title: "Yangi bosqich qo'shish",
    submit: "Qo'shish",
    body: `<div class="form-grid"><div class="fld full"><label class="req">Nomi</label><input class="inp" name="name" placeholder="Masalan: Shartnoma imzolandi"></div>
      <div class="fld"><label>Rangi</label><input class="inp" type="color" name="color" value="#5b8def" style="width:80px;padding:2px"></div></div>`,
    onSubmit: v => stages.create(v),
  });
  if (r) { toast("Bosqich qo'shildi"); refresh(); }
}

/* ---------------- Jadval ---------------- */
async function tableHtml() {
  const { rows, total } = await leads.query({ ...filters(), page: st.page, size: st.size });
  const bulk = can('leads.bulk');
  const allSel = rows.length && rows.every(r => st.sel.has(r.id));
  return `${bulk && st.sel.size ? `<div class="bulk"><b>${st.sel.size} ta tanlandi</b>
      <button class="btn sm primary" data-act="bulk-transfer">${icon('swap')} O'tkazish</button>
      <button class="btn sm light" data-act="bulk-clear">Bekor qilish</button></div>` : ''}
    <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      ${bulk ? `<th class="chk"><input type="checkbox" class="check" data-selall ${allSel ? 'checked' : ''}></th>` : ''}
      <th>Mijoz</th><th>Telefon</th><th>Status</th>${can('leads.all') ? '<th>Mas\'ul</th>' : ''}<th>Kurs</th><th>Manba</th><th>To'lov</th><th>Kelgan</th><th>Keyingi aloqa</th>
    </tr></thead><tbody>
    ${rows.map(l => `<tr class="click ${st.sel.has(l.id) ? 'sel' : ''}" data-open="${l.id}">
      ${bulk ? `<td class="chk"><input type="checkbox" data-sel="${l.id}" ${st.sel.has(l.id) ? 'checked' : ''}></td>` : ''}
      <td class="name-cell"><b>${esc(l.name)}</b></td>
      <td class="nowrap">${esc(fmtPhone(l.phone))}</td>
      <td>${badge(l.status?.name, l.status?.color)}</td>
      ${can('leads.all') ? `<td class="nowrap">${esc(l.owner_name || '—')}</td>` : ''}
      <td>${esc(l.course_name)}</td>
      <td class="nowrap">${esc(l.source)}</td>
      <td>${l.pay_status ? badge(PAY_STATUS[l.pay_status].name, PAY_STATUS[l.pay_status].color) : ''}</td>
      <td class="nowrap">${fmtDate(l.created_at)}</td>
      <td class="nowrap ${l.next_contact_at && new Date(l.next_contact_at) < new Date() ? 'red' : ''}">${fmtDT(l.next_contact_at)}</td>
    </tr>`).join('')}
    </tbody></table></div>
    ${rows.length ? '' : `<div class="empty">Lead topilmadi</div>`}
    ${pager(total, st.page, st.size)}</div>`;
}

/* ---------------- Excel ---------------- */
async function doExport() {
  try {
    const rows = await leads.all(filters());
    await exportExcel(`leadlar_${today()}.xlsx`, [{
      name: 'Leadlar',
      rows: rows.map(l => ({
        'Ism': l.first_name, 'Familiya': l.last_name, 'Telefon': l.phone, 'Status': l.status?.name || '',
        "Mas'ul": l.owner_name, 'Kurs': l.course_name, 'Manba': l.source, "To'lov holati": l.pay_status ? PAY_STATUS[l.pay_status].name : '',
        'Kelgan sana': fmtDT(l.created_at), 'Keyingi aloqa': fmtDT(l.next_contact_at), 'Izoh': l.comment,
      })),
    }]);
    toast(`${rows.length} ta lead Excelga yuklandi`);
  } catch (ex) { toast(ex.message, 'err'); }
}

async function doImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    let sheets;
    try { sheets = await readExcel(file); } catch (ex) { return toast(ex.message, 'err'); }
    sheets = sheets.filter(s => s.rows.length);
    if (!sheets.length) return toast("Faylda ma'lumot topilmadi", 'err');
    const sellers = staff.sellers({ activeOnly: true });
    let sheet = sheets[0];
    const mapHtml = s => {
      const headers = Object.keys(s.rows[0]);
      const g = guessMapping(headers);
      return `<table class="tbl"><thead><tr><th>Excel ustuni</th><th>Namuna</th><th>CRM maydoni</th></tr></thead><tbody>
        ${headers.map(h => `<tr><td><b>${esc(h)}</b></td><td class="muted small">${esc(String(s.rows[0][h]).slice(0, 30))}</td>
          <td><select class="sel" data-map="${esc(h)}">${options(Object.entries(IMPORT_FIELDS), g[h] || '', { empty: '— olinmaydi —' })}</select></td></tr>`).join('')}
      </tbody></table>`;
    };
    const res = await modal({
      title: `Excel import: ${file.name}`,
      wide: true,
      submit: 'Import qilish',
      body: `<div class="form-grid">
          <div class="fld"><label>Varaq</label><select class="sel" name="sheet">${options(sheets.map((s, i) => [i, `${s.name} (${s.rows.length} qator)`]), 0)}</select></div>
          <div class="fld"><label>Sotuvchiga biriktirish</label><select class="sel" name="ownerMode">${options([['auto', 'Avtomatik (navbat bilan)'], ['column', "Excel'dagi Sotuvchi ustuni bo'yicha"], ['one', 'Bitta sotuvchiga'], ['none', 'Biriktirmaslik']], 'auto')}</select></div>
          <div class="fld" data-one hidden><label>Sotuvchi</label><select class="sel" name="ownerId">${options(sellers.map(s => [s.id, s.full_name]), '')}</select></div>
        </div>
        <div class="sec-title" style="margin-top:16px">Ustunlarni moslashtirish</div>
        <div data-map-box class="tbl-wrap" style="max-height:300px">${mapHtml(sheet)}</div>
        <p class="muted small">Telefon raqamlar avtomatik +998 formatiga keltiriladi. Bazada bor raqamlar takroriy deb o'tkazib yuboriladi.</p>`,
      onMount(form) {
        form.sheet.onchange = () => { sheet = sheets[Number(form.sheet.value)]; $('[data-map-box]', form).innerHTML = mapHtml(sheet); };
        form.ownerMode.onchange = () => { $('[data-one]', form).hidden = form.ownerMode.value !== 'one'; };
      },
      async onSubmit(v, form) {
        const map = {};
        for (const s of $$('[data-map]', form)) if (s.value) map[s.dataset.map] = s.value;
        const fields = Object.values(map);
        if (!fields.includes('phone')) throw new Error('Telefon ustunini belgilang');
        if (!fields.includes('first_name') && !fields.includes('full_name')) throw new Error('Ism ustunini belgilang');
        return leads.importRows(applyMapping(sheet.rows, map), { ownerMode: v.ownerMode, ownerId: v.ownerId });
      },
    });
    if (res) {
      toast(`Qo'shildi: ${res.added}, takroriy: ${res.duplicates}, xato: ${res.invalid}`);
      changed();
      refresh();
    }
  };
  input.click();
}

/* ---------------- hodisalar ---------------- */
const search = debounce(() => { st.page = 1; refresh(); }, 200);

function onInput(e) {
  if (e.target.matches('[data-f="q"]')) { st.q = e.target.value; search(); }
}

function onChange(e) {
  const f = e.target.dataset.f;
  if (f && f !== 'q') {
    st[f] = e.target.value;
    st.page = 1;
    st.sel.clear();
    drawToolbar();
    drawBody();
    return;
  }
  if (e.target.matches('[data-sel]')) {
    const id = e.target.dataset.sel;
    e.target.checked ? st.sel.add(id) : st.sel.delete(id);
    refresh();
  }
  if (e.target.matches('[data-selall]')) {
    $$('[data-sel]', root).forEach(c => (e.target.checked ? st.sel.add(c.dataset.sel) : st.sel.delete(c.dataset.sel)));
    refresh();
  }
}

async function onClick(e) {
  const t = e.target;
  if (t.closest('input[type=checkbox]')) return;
  const view = t.closest('[data-view]');
  if (view) { st.view = view.dataset.view; st.sel.clear(); drawToolbar(); return drawBody(); }
  const pg = t.closest('[data-page]');
  if (pg) { st.page = Number(pg.dataset.page); return refresh(); }
  const more = t.closest('[data-more]');
  if (more) { st.limits[more.dataset.more] = (st.limits[more.dataset.more] || 30) + 30; return refresh(); }
  const stage = t.closest('[data-stage]');
  if (stage) return stageMenu(stage.dataset.stage);
  const open = t.closest('[data-id],[data-open]');
  if (open) return openLead(open.dataset.id || open.dataset.open, refresh);
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'new') newLeadModal(refresh);
  if (act === 'clear') { Object.assign(st, { q: '', owner: '', status: '', source: '', course: '', pay: '', from: '', to: '', page: 1 }); drawToolbar(); drawBody(); }
  if (act === 'addstage') addStage();
  if (act === 'export') doExport();
  if (act === 'import') doImport();
  if (act === 'bulk-clear') { st.sel.clear(); refresh(); }
  if (act === 'bulk-transfer') transferModal([...st.sel], () => { st.sel.clear(); refresh(); });
}

