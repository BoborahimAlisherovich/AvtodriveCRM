// Kurslar (About): nomi, narxi, davomiyligi, jadval, mavzular, o'qituvchi.
import { courses } from '../data/api.js';
import { can } from '../auth.js';
import { esc, money, icon, toast, modal, badge } from '../ui.js';

let root;

export function render(el) {
  root = el;
  draw();
  el.onclick = onClick;
}

function draw() {
  const manage = can('courses.manage');
  const list = courses.list({ includeInactive: manage });
  root.innerHTML = `${manage ? `<div class="toolbar"><span class="muted">${list.length} ta kurs</span><div class="grow"></div><button class="btn primary" data-act="new">${icon('plus')} Kurs</button></div>` : ''}
    <div class="cards">${list.map(c => `<div class="panel course ${c.active ? '' : 'off'}">
      <div style="display:flex;align-items:flex-start;gap:8px"><h3 style="flex:1">${esc(c.name)}</h3>${c.active ? '' : badge('Nofaol', '#9aa3ab')}</div>
      <div class="price">${money(c.price)}</div>
      <div class="muted small">${esc(c.description)}</div>
      <dl><dt>Davomiyligi</dt><dd>${esc(c.duration)}</dd><dt>Jadval</dt><dd>${esc(c.schedule)}</dd><dt>O'qituvchi</dt><dd>${esc(c.teacher)}</dd><dt>Mavzular</dt><dd>${esc(c.topics)}</dd></dl>
      ${manage ? `<div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" data-edit="${c.id}">${icon('edit')} Tahrirlash</button><button class="btn sm light" data-toggle="${c.id}">${c.active ? 'Faolsizlantirish' : 'Faollashtirish'}</button></div>` : ''}
    </div>`).join('')}</div>`;
}

function form(c = {}) {
  return `<div class="form-grid">
    <div class="fld full"><label class="req">Kurs nomi</label><input class="inp" name="name" value="${esc(c.name || '')}"></div>
    <div class="fld"><label>Narxi (so'm)</label><input class="inp" type="number" step="1000" name="price" value="${c.price || ''}"></div>
    <div class="fld"><label>Davomiyligi</label><input class="inp" name="duration" value="${esc(c.duration || '')}" placeholder="3 oy"></div>
    <div class="fld full"><label>Dars jadvali</label><input class="inp" name="schedule" value="${esc(c.schedule || '')}" placeholder="Du-Chor-Ju, 18:00–19:30"></div>
    <div class="fld full"><label>O'qituvchi</label><input class="inp" name="teacher" value="${esc(c.teacher || '')}"></div>
    <div class="fld full"><label>Tavsif</label><textarea class="inp" name="description" rows="2">${esc(c.description || '')}</textarea></div>
    <div class="fld full"><label>O'tiladigan mavzular</label><textarea class="inp" name="topics" rows="2">${esc(c.topics || '')}</textarea></div>
  </div>`;
}

async function onClick(e) {
  if (e.target.closest('[data-act="new"]')) {
    if (await modal({ title: 'Yangi kurs', submit: "Qo'shish", body: form(), onSubmit: v => courses.save(v) })) { toast("Kurs qo'shildi"); draw(); }
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const c = courses.list({ includeInactive: true }).find(x => x.id === ed.dataset.edit);
    if (await modal({ title: 'Kursni tahrirlash', body: form(c), onSubmit: v => courses.save({ ...v, id: c.id }) })) { toast('Saqlandi'); draw(); }
  }
  const tg = e.target.closest('[data-toggle]');
  if (tg) { await courses.toggle(tg.dataset.toggle); draw(); }
}
