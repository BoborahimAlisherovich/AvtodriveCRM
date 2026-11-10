// Xodimlar: qo'shish, tahrirlash, rol va faollik (faqat FULL ADMIN).
import { staff, attendance, ATT, isAtWork, mode } from '../data/api.js';
import { ROLES, me } from '../auth.js';
import { esc, fmtPhone, options, badge, icon, toast, modal, initials, confirmBox } from '../ui.js';

let root;
let show = 'active'; // active | inactive | all

export function render(el) {
  root = el;
  draw();
  el.onclick = onClick;
}

function draw() {
  const all = staff.list();
  const list = all.filter(p => show === 'all' || (show === 'active' ? p.active : !p.active));
  const nAct = all.filter(p => p.active).length;
  root.innerHTML = `<div class="toolbar">
      <div class="seg"><button data-show="active" class="${show === 'active' ? 'on' : ''}">Faol (${nAct})</button><button data-show="inactive" class="${show === 'inactive' ? 'on' : ''}">Nofaol (${all.length - nAct})</button><button data-show="all" class="${show === 'all' ? 'on' : ''}">Hammasi (${all.length})</button></div>
      <div class="grow"></div>
      <button class="btn primary" data-act="new">${icon('plus')} Xodim</button></div>
    <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Xodim</th><th>Telefon</th><th>Login</th><th>Rol</th><th>Lavozim</th><th>Ish vaqti</th><th>Holat</th><th>Bugun</th><th>Taqsimot</th><th></th>
    </tr></thead><tbody>
    ${list.map(p => {
      const a = attendance.todayStatus(p.id);
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc(initials(p.full_name))}</span><b>${esc(p.full_name)}</b></div></td>
        <td class="nowrap">${esc(fmtPhone(p.phone))}</td>
        <td>${esc(p.email)}</td>
        <td><span class="tag">${ROLES[p.role]}</span></td>
        <td>${esc(p.position)}</td>
        <td class="nowrap">${esc(p.schedule)} · ${esc(p.work_start)}–${esc(p.work_end)}</td>
        <td>${p.active ? badge('Faol', '#7bd500') : badge('Nofaol', '#9aa3ab')}</td>
        <td>${a ? badge(ATT[a].name, ATT[a].color) : '<span class="muted small">belgilanmagan</span>'}</td>
        <td>${p.role === 'seller' ? (isAtWork(p.id) ? '<span class="green small">Navbatda</span>' : '<span class="muted small">Yo\'q</span>') : ''}</td>
        <td class="nowrap" style="text-align:right"><button class="icon-btn" data-edit="${p.id}" title="Tahrirlash">${icon('edit')}</button>
          ${p.id !== me().id ? `<button class="btn sm" data-toggle="${p.id}">${p.active ? 'Faolsizlantirish' : 'Faollashtirish'}</button>` : ''}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>${list.length ? '' : `<div class="empty">${show === 'inactive' ? "Nofaol xodim yo'q" : "Xodim yo'q"}</div>`}</div>
    <p class="muted small">Nofaol xodim tizimga kira olmaydi va unga yangi lead taqsimlanmaydi. Bugun ishga kelmagan sotuvchiga ham lead tushmaydi. Avval biriktirilgan leadlar olib qo'yilmaydi.</p>`;
}

function form(p = {}) {
  return `<div class="form-grid">
    <div class="fld full"><label class="req">Ism va familiya</label><input class="inp" name="full_name" value="${esc(p.full_name || '')}"></div>
    <div class="fld"><label>Telefon</label><input class="inp" name="phone" value="${esc(fmtPhone(p.phone || ''))}" placeholder="+998 90 123 45 67"></div>
    <div class="fld"><label class="req">Login (email)</label><input class="inp" name="email" type="email" value="${esc(p.email || '')}" ${p.id && mode !== 'demo' ? 'readonly' : ''}></div>
    <div class="fld"><label>Tizimdagi rol</label><select class="sel" name="role">${options(Object.entries(ROLES), p.role || 'seller')}</select></div>
    <div class="fld"><label>Lavozim</label><input class="inp" name="position" value="${esc(p.position || 'Sotuv menejeri')}"></div>
    <div class="fld"><label>Ish kunlari</label><input class="inp" name="schedule" value="${esc(p.schedule || 'Du–Sha')}"></div>
    <div class="fld"><label>Tug'ilgan kun</label><input class="inp" type="date" name="birthday" value="${esc(p.birthday || '')}"></div>
    <div class="fld"><label>Ishga kelish vaqti</label><input class="inp" type="time" name="work_start" value="${esc(p.work_start || '09:00')}"></div>
    <div class="fld"><label>Ishdan ketish vaqti</label><input class="inp" type="time" name="work_end" value="${esc(p.work_end || '18:00')}"></div>
    ${p.id ? '' : `<div class="fld full"><label>Parol</label><input class="inp" name="password" type="text" autocomplete="new-password" minlength="8">
      <div class="hint">Bo'sh qoldirsangiz, xodimning emailiga taklif xati boradi va u parolni o'zi o'rnatadi. Kamida 8 belgi.</div></div>`}
  </div>`;
}

async function onClick(e) {
  const t = e.target;
  const sh = t.closest('[data-show]');
  if (sh) { show = sh.dataset.show; return draw(); }
  if (t.closest('[data-act="new"]')) {
    const r = await modal({ title: "Yangi xodim", submit: "Qo'shish", body: form(), onSubmit: v => staff.create(v) });
    if (r) { toast("Xodim qo'shildi"); draw(); }
  }
  const ed = t.closest('[data-edit]');
  if (ed) {
    const p = staff.list().find(x => x.id === ed.dataset.edit);
    const r = await modal({ title: 'Xodimni tahrirlash', body: form(p), onSubmit: v => staff.update(p.id, v) });
    if (r) { toast('Saqlandi'); draw(); }
  }
  const tg = t.closest('[data-toggle]');
  if (tg) {
    const p = staff.list().find(x => x.id === tg.dataset.toggle);
    if (p.active && !await confirmBox(`${p.full_name} faolsizlantirilsinmi? U tizimga kira olmaydi va unga yangi lead tushmaydi.`, { ok: 'Faolsizlantirish', danger: true })) return;
    try { await staff.update(p.id, { active: !p.active }); toast(p.active ? 'Faolsizlantirildi' : 'Faollashtirildi'); draw(); } catch (ex) { toast(ex.message, 'err'); }
  }
}
