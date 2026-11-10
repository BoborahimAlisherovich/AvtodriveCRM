// Sozlamalar (faqat FULL ADMIN): umumiy, lead taqsimoti, manbalar, zaxira.
import { settings, staff, backupTables, resetDemo, mode, PAY_STATUS, payStatus, ACTIONS, today } from '../data/api.js';
import { esc, icon, toast, confirmBox, fmtDT, $ } from '../ui.js';
import { exportExcel } from '../excel.js';

let root;
let order;

export function render(el) {
  root = el;
  order = settings.get().rr_order;
  draw();
  el.onclick = onClick;
}

function draw() {
  const s = settings.get();
  const sellers = staff.sellers();
  const name = id => sellers.find(x => x.id === id);
  root.innerHTML = `<div class="grid2">
    <form class="panel panel-pad stack" data-form>
      <div class="sec-title" style="margin:0">Umumiy</div>
      <div class="form-grid">
        <div class="fld"><label>Markaz nomi</label><input class="inp" name="center_name" value="${esc(s.center_name)}"></div>
        <div class="fld"><label>Telegram bot (username)</label><input class="inp" name="bot_username" value="${esc(s.bot_username)}"></div>
        <div class="fld"><label>To'lov eslatmasi (necha kun oldin)</label><input class="inp" type="number" min="0" max="30" name="remind_days_before" value="${s.remind_days_before}"></div>
        <div class="fld full"><label>Telegram bot: «Biz haqimizda» matni</label><textarea class="inp" name="bot_about" rows="4">${esc(s.bot_about || '')}</textarea></div>
        <div class="fld full"><label>Telegram bot: «Aloqa» matni (manzil, telefon, ish vaqti)</label><textarea class="inp" name="bot_contacts" rows="3">${esc(s.bot_contacts || '')}</textarea></div>
        <div class="fld full"><label>Lead manbalari (har biri yangi qatorda)</label><textarea class="inp" name="sources" rows="6">${esc(s.sources.join('\n'))}</textarea></div>
      </div>
      <div class="sec-title" style="margin:6px 0 0">Lead taqsimoti</div>
      <label class="check"><input type="checkbox" name="require_attendance" ${s.require_attendance ? 'checked' : ''}> Faqat bugun "Ishda" deb belgilangan sotuvchilarga taqsimlash</label>
      <label class="check"><input type="checkbox" name="seller_can_transfer" ${s.seller_can_transfer ? 'checked' : ''}> Sotuvchilar o'z leadini boshqa sotuvchiga yo'naltira oladi</label>
      <div class="fld"><label>Navbat tartibi (Round Robin)</label>
        <div class="rr-list">${order.map((id, i) => {
          const p = name(id);
          return p ? `<div class="rr-item"><b>${i + 1}.</b><span class="grow">${esc(p.full_name)} ${p.active ? '' : '<span class="muted small">(nofaol)</span>'}${s.rr_last === id ? ' <span class="tag">oxirgi lead shunga berilgan</span>' : ''}</span>
            <button type="button" class="btn sm light" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn sm light" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></div>` : '';
        }).join('')}</div></div>
      <div><button class="btn primary" type="submit">Saqlash</button></div>
    </form>
    <div class="stack">
      <div class="panel panel-pad"><div class="sec-title">Zaxira nusxa</div>
        <p class="small muted" style="margin-top:0">Tizimdagi barcha ma'lumotlar (leadlar, to'lovlar, tarix, davomat, loglar) alohida varaqlarda bitta Excel faylga yuklanadi.</p>
        <button class="btn blue" data-act="backup">${icon('excel')} Hammasini Excelga yuklab olish</button></div>
      ${mode === 'demo' ? `<div class="panel panel-pad"><div class="sec-title">Demo ma'lumotlar</div>
        <p class="small muted" style="margin-top:0">Hozir ma'lumotlar shu brauzerda saqlanmoqda. Supabase ulanganda haqiqiy bazaga o'tiladi.</p>
        <button class="btn danger" data-act="reset">Demo ma'lumotlarni qayta tiklash</button></div>` : ''}
    </div></div>`;
  $('[data-form]', root).onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await settings.save({
        center_name: f.center_name.value.trim(), bot_username: f.bot_username.value.trim().replace(/^@/, ''),
        remind_days_before: Number(f.remind_days_before.value) || 0,
        bot_about: f.bot_about.value.trim(), bot_contacts: f.bot_contacts.value.trim(),
        sources: f.sources.value.split('\n').map(x => x.trim()).filter(Boolean),
        require_attendance: f.require_attendance.checked, seller_can_transfer: f.seller_can_transfer.checked,
        rr_order: order,
      });
      toast('Sozlamalar saqlandi');
    } catch (ex) { toast(ex.message, 'err'); }
  };
}

async function backup() {
  const db = await backupTables();
  const name = id => db.profiles.find(p => p.id === id)?.full_name || '';
  const lead = id => db.leads.find(l => l.id === id);
  const lname = id => { const l = lead(id); return l ? `${l.first_name} ${l.last_name}` : ''; };
  const status = id => db.lead_statuses.find(s => s.id === id)?.name || '';
  const course = id => db.courses.find(c => c.id === id)?.name || '';
  const t = today();
  await exportExcel(`avtodrive_crm_zaxira_${t}.xlsx`, [
    { name: 'Leadlar', rows: db.leads.map(l => ({ ID: l.id, Ism: l.first_name, Familiya: l.last_name, Telefon: l.phone, Manba: l.source, "Mas'ul": name(l.owner_id), Status: status(l.status_id), Kurs: course(l.course_id), 'Kelgan sana': fmtDT(l.created_at), 'Keyingi aloqa': fmtDT(l.next_contact_at), Izoh: l.comment })) },
    { name: "To'lovlar", rows: db.payments.map(p => ({ ID: p.id, Mijoz: lname(p.lead_id), Telefon: lead(p.lead_id)?.phone || '', Kurs: course(p.course_id), Umumiy: p.total, "To'langan": p.paid, Qolgan: p.total - p.paid, Muddat: p.due_date, "Keyingi to'lov": p.next_date || '', Status: PAY_STATUS[payStatus(p)].name, Izoh: p.note })) },
    { name: "To'lov tarixi", rows: db.payment_history.map(h => ({ "To'lov ID": h.payment_id, Mijoz: lname(db.payments.find(p => p.id === h.payment_id)?.lead_id), Amal: h.action, Summa: h.amount ?? '', Kim: name(h.user_id), Vaqt: fmtDT(h.created_at), Izoh: h.note || '' })) },
    { name: 'Izohlar', rows: db.lead_notes.map(n => ({ Mijoz: lname(n.lead_id), Izoh: n.text, Muallif: name(n.author_id), Vaqt: fmtDT(n.created_at) })) },
    { name: "Lead o'tkazmalari", rows: db.lead_assignments.map(a => ({ Mijoz: lname(a.lead_id), Kimdan: name(a.from_id), Kimga: name(a.to_id), "Kim o'tkazdi": a.by_id ? name(a.by_id) : 'Tizim', Sabab: a.reason, Vaqt: fmtDT(a.created_at) })) },
    { name: 'Xodimlar', rows: db.profiles.map(p => ({ Ism: p.full_name, Telefon: p.phone, Login: p.email, Rol: p.role, Lavozim: p.position, Faol: p.active ? 'Ha' : "Yo'q" })) },
    { name: 'Davomat', rows: db.attendance.map(a => ({ Xodim: name(a.profile_id), Sana: a.date, Holat: a.status, Izoh: a.note })) },
    { name: 'Kurslar', rows: db.courses.map(c => ({ Nomi: c.name, Narxi: c.price, Davomiyligi: c.duration, Jadval: c.schedule, "O'qituvchi": c.teacher, Faol: c.active ? 'Ha' : "Yo'q" })) },
    { name: 'Activity Log', rows: db.activity_logs.map(l => ({ Vaqt: fmtDT(l.created_at), Foydalanuvchi: l.user_id ? name(l.user_id) : 'Tizim', Amal: ACTIONS[l.action] || l.action, Obyekt: l.label })) },
  ]);
}

async function onClick(e) {
  const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
  if (up || down) {
    const i = Number((up || down).dataset[up ? 'up' : 'down']);
    const j = up ? i - 1 : i + 1;
    [order[i], order[j]] = [order[j], order[i]];
    const f = $('[data-form]', root);
    const keep = Object.fromEntries(new FormData(f));
    draw();
    const nf = $('[data-form]', root);
    for (const [k, v] of Object.entries(keep)) if (nf[k] && nf[k].type !== 'checkbox') nf[k].value = v;
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'backup') { try { await backup(); toast('Zaxira fayl yuklab olindi'); } catch (ex) { toast(ex.message, 'err'); } }
  if (act === 'reset' && await confirmBox("Barcha o'zgarishlar o'chib, demo ma'lumotlar qayta yaratiladi. Davom etilsinmi?", { ok: 'Tiklash', danger: true })) {
    resetDemo();
    location.reload();
  }
}
