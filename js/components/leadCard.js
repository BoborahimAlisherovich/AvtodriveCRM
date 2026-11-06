// Lead kartasi (o'ng panel), yangi lead va o'tkazish oynalari.
import { leads, stages, courses, staff, telegram, settings, PAY_STATUS, ACTIONS, profileName } from '../data/api.js';
import { me, can } from '../auth.js';
import { esc, money, fmtDT, fmtPhone, toLocalInput, modal, options, toast, badge, openDrawer, closeDrawer, icon, confirmBox, $ } from '../ui.js';
import { createPaymentModal, receiveModal, openPayment } from './payForms.js';

const changed = () => dispatchEvent(new Event('crm:changed'));

export function newLeadModal(onDone) {
  const u = me();
  const sellers = staff.sellers({ activeOnly: true });
  const src = settings.get().sources;
  return modal({
    title: 'Yangi lead',
    submit: "Qo'shish",
    body: `<div class="form-grid">
      <div class="fld"><label class="req">Ism</label><input class="inp" name="first_name" autofocus></div>
      <div class="fld"><label>Familiya</label><input class="inp" name="last_name"></div>
      <div class="fld"><label class="req">Telefon</label><input class="inp" name="phone" type="tel" placeholder="+998 90 123 45 67"><div class="hint" data-dup></div></div>
      <div class="fld"><label>Manba</label><select class="sel" name="source">${options(src, "Qo'lda kiritish")}</select></div>
      <div class="fld"><label>Kurs</label><select class="sel" name="course_id">${options(courses.list().map(c => [c.id, c.name]), '', { empty: '— tanlanmagan —' })}</select></div>
      ${u.role === 'seller' ? '' : `<div class="fld"><label>Mas'ul sotuvchi</label><select class="sel" name="owner_id">${options([['auto', 'Avtomatik (navbat bilan)'], ...sellers.map(s => [s.id, s.full_name])], 'auto')}</select></div>`}
      <div class="fld"><label>Keyingi aloqa</label><input class="inp" name="next_contact_at" type="datetime-local"></div>
      <div class="fld full"><label>Izoh</label><textarea class="inp" name="comment" rows="2"></textarea></div>
    </div>`,
    onMount(form) {
      const hint = $('[data-dup]', form);
      form.phone.addEventListener('blur', async () => {
        const d = form.phone.value.trim() ? await leads.findByPhone(form.phone.value).catch(() => null) : null;
        hint.innerHTML = d ? `<span class="red">Bu raqam bazada bor: ${esc(d.name)} (${esc(d.owner)})</span>` : '';
      });
    },
    async onSubmit(v) {
      const l = await leads.create(v);
      toast(l.owner_id ? `Lead qo'shildi → ${profileName(l.owner_id)}` : "Lead qo'shildi (ishda sotuvchi yo'q — biriktirilmagan)");
      changed();
      onDone?.(l);
      return l;
    },
  });
}

export function transferModal(ids, onDone) {
  const u = me();
  const sellers = staff.sellers({ activeOnly: true }).filter(s => s.id !== u.id || u.role !== 'seller');
  return modal({
    title: ids.length > 1 ? `${ids.length} ta leadni o'tkazish` : "Leadni boshqa sotuvchiga o'tkazish",
    submit: "O'tkazish",
    body: `<div class="form-grid">
      <div class="fld full"><label class="req">Yangi sotuvchi</label><select class="sel" name="to">${options(sellers.map(s => [s.id, s.full_name]), '', { empty: '— tanlang —' })}</select></div>
      <div class="fld full"><label class="req">Sabab</label><textarea class="inp" name="reason" rows="2" placeholder="Masalan: mijoz rus tilida gaplashadi"></textarea></div>
    </div><p class="muted small" style="margin:10px 0 0">Eski va yangi sotuvchi, vaqt, kim o'tkazgani va sabab tarixda saqlanadi.</p>`,
    async onSubmit(v) {
      const n = await leads.transfer(ids, v.to, v.reason);
      toast(`${n} ta lead o'tkazildi`);
      changed();
      onDone?.(n);
      return n;
    },
  });
}

function statusSelect(lead, list) {
  const c = lead.status?.color || '#2fc6f6';
  return `<select class="status-select" data-status style="background:${esc(c)}">${list.map(s => `<option value="${s.id}"${s.id === lead.status_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
}

function fieldVal(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'next_contact_at') return fmtDT(v);
  if (k === 'course_id') return courses.list({ includeInactive: true }).find(c => c.id === v)?.name || v;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const FIELD = { first_name: 'Ism', last_name: 'Familiya', phone: 'Telefon', source: 'Manba', course_id: 'Kurs', next_contact_at: 'Keyingi aloqa', comment: 'Izoh', birthday: "Tug'ilgan kun" };

function historyHtml(lead) {
  const items = [
    ...lead.logs.filter(l => l.action !== 'lead.transfer' && l.action !== 'lead.assign' && l.action !== 'lead.note').map(l => ({ at: l.created_at, html: logLine(l) })),
    ...lead.assignments.map(a => ({
      at: a.created_at,
      html: `<div class="tl-dot">${icon('swap')}</div><div class="grow"><div>${a.from ? `<b>${esc(a.from)}</b> → <b>${esc(a.to)}</b>` : `Biriktirildi: <b>${esc(a.to)}</b>`}</div>
        <div class="small muted">${esc(a.reason || '')}</div><div class="meta">${fmtDT(a.created_at)} · ${esc(a.by)}</div></div>`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return items.map(i => `<div class="tl-item">${i.html}</div>`).join('') || '<div class="muted">Tarix yo\'q</div>';
}
function logLine(l) {
  let detail = '';
  if (l.action === 'lead.status') detail = `<s class="muted">${esc(l.old)}</s> → <b>${esc(l.new)}</b>`;
  else if (l.action === 'lead.edit' && l.new) detail = Object.keys(l.new).map(k => `${FIELD[k] || k}: <s class="muted">${esc(fieldVal(k, l.old?.[k]))}</s> → <b>${esc(fieldVal(k, l.new[k]))}</b>`).join('<br>');
  else if (l.action === 'lead.create') detail = `Manba: ${esc(l.new || '')}`;
  return `<div class="tl-dot">${icon(l.action === 'lead.status' ? 'kanban' : 'edit')}</div><div class="grow"><div><b>${esc(ACTIONS[l.action] || l.action)}</b></div>
    <div class="small">${detail}</div><div class="meta">${fmtDT(l.created_at)} · ${esc(l.user)}</div></div>`;
}

export async function openLead(id, onChange) {
  const d = openDrawer();
  const list = stages.list();
  const src = settings.get().sources;
  const draw = async () => {
    let lead;
    try { lead = await leads.get(id); } catch (e) { toast(e.message, 'err'); return closeDrawer(); }
    const courseList = courses.list({ includeInactive: true });
    d.innerHTML = `<div class="drawer-head"><div class="grow">
        <div class="muted small">Lead · ${fmtDT(lead.created_at)} · ${esc(lead.source)}</div>
        <h2>${esc(lead.name)}</h2>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
          ${statusSelect(lead, list)}
          <a href="tel:${esc(lead.phone)}" class="btn sm">${icon('phone')} ${esc(fmtPhone(lead.phone))}</a>
          <span class="muted small">Mas'ul: <b>${esc(lead.owner_name || 'biriktirilmagan')}</b></span>
          ${can('leads.transfer') ? `<button class="btn sm" data-act="transfer">${icon('swap')} O'tkazish</button>` : ''}
        </div>
      </div><button class="icon-btn" data-close aria-label="Yopish">${icon('close')}</button></div>
      <div class="drawer-body">
        <form class="panel panel-pad" data-form>
          <div class="sec-title">Mijoz ma'lumotlari</div>
          <div class="form-grid">
            <div class="fld"><label>Ism</label><input class="inp" name="first_name" value="${esc(lead.first_name)}"></div>
            <div class="fld"><label>Familiya</label><input class="inp" name="last_name" value="${esc(lead.last_name)}"></div>
            <div class="fld"><label>Telefon</label><input class="inp" name="phone" value="${esc(fmtPhone(lead.phone))}"></div>
            <div class="fld"><label>Manba</label><select class="sel" name="source">${options(src.includes(lead.source) ? src : [...src, lead.source], lead.source)}</select></div>
            <div class="fld"><label>Kurs</label><select class="sel" name="course_id">${options(courseList.map(c => [c.id, c.name]), lead.course_id, { empty: '— tanlanmagan —' })}</select></div>
            <div class="fld"><label>Keyingi aloqa (qayta qo'ng'iroq)</label><input class="inp" type="datetime-local" name="next_contact_at" value="${toLocalInput(lead.next_contact_at)}"></div>
            <div class="fld"><label>Tug'ilgan kun</label><input class="inp" type="date" name="birthday" value="${esc(lead.birthday || '')}"></div>
            <div class="fld full"><label>Umumiy izoh</label><textarea class="inp" name="comment" rows="2">${esc(lead.comment)}</textarea></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" type="submit">Saqlash</button>
            ${can('leads.delete') ? `<button type="button" class="btn danger" data-act="delete" style="margin-left:auto">O'chirish</button>` : ''}</div>
        </form>

        <div class="panel panel-pad">
          <div class="sec-title" style="display:flex;align-items:center">To'lovlar
            ${can('payments.create') ? `<button class="btn sm primary" data-act="newpay" style="margin-left:auto">${icon('plus')} To'lov</button>` : ''}</div>
          ${lead.payments.length ? lead.payments.map(p => `<div class="pay-row">
              <div style="flex:1;min-width:160px"><a href="#" data-pay="${p.id}"><b>${esc(p.course_name || "To'lov")}</b></a><div class="small muted">${money(p.paid)} / ${money(p.total)}${p.due ? ' · muddat ' + esc(p.due.split('-').reverse().join('.')) : ''}</div></div>
              ${badge(PAY_STATUS[p.status].name, PAY_STATUS[p.status].color)}
              ${p.remaining > 0 && p.status !== 'bekor' ? `<button class="btn sm" data-receive="${p.id}">Qabul qilish</button>` : ''}
            </div>`).join('') : '<div class="muted small">To\'lov yo\'q</div>'}
        </div>

        <div class="panel panel-pad">
          <div class="sec-title">Telegram</div>
          ${lead.telegram_chat_id ? `<div>${badge('Botga ulangan', '#7bd500')}</div>`
            : `<div class="small muted">Mijoz botga ulanmagan. Bir martalik havola yarating va mijozga yuboring (24 soat amal qiladi).</div>
               <div data-link></div><button class="btn sm blue" data-act="tglink" style="margin-top:8px">${icon('link')} Havola yaratish</button>`}
        </div>

        <div class="panel panel-pad">
          <div class="sec-title">Izohlar</div>
          <form data-note style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
            <textarea class="inp" name="text" rows="2" placeholder="Izoh yozing... (Ctrl+Enter)"></textarea>
            <button class="btn primary" type="submit">Qo'shish</button>
          </form>
          <div class="timeline">${lead.notes.map(n => `<div class="tl-item"><div class="tl-dot">${icon('note')}</div><div class="grow"><div class="note-text">${esc(n.text)}</div><div class="meta">${fmtDT(n.created_at)} · ${esc(n.author)}</div></div></div>`).join('') || '<div class="muted small">Hali izoh yo\'q</div>'}</div>
        </div>

        <div class="panel panel-pad"><div class="sec-title">Tarix</div><div class="timeline">${historyHtml(lead)}</div></div>
      </div>`;

    const after = () => { draw(); onChange?.(); };
    $('[data-status]', d).onchange = async e => {
      try {
        const s = list.find(x => x.id === e.target.value);
        await leads.setStatus(id, s.id);
        toast(`Status: ${s.name}`);
        changed();
        after();
        if (s.kind === 'won' && !lead.payments.length && can('payments.create')) createPaymentModal({ leadId: id, onDone: after });
      } catch (ex) { toast(ex.message, 'err'); }
    };
    $('[data-form]', d).onsubmit = async e => {
      e.preventDefault();
      try {
        await leads.update(id, Object.fromEntries(new FormData(e.target)));
        toast('Saqlandi');
        after();
      } catch (ex) { toast(ex.message, 'err'); }
    };
    const noteForm = $('[data-note]', d);
    noteForm.onsubmit = async e => {
      e.preventDefault();
      try { await leads.addNote(id, noteForm.text.value); toast("Izoh qo'shildi"); after(); } catch (ex) { toast(ex.message, 'err'); }
    };
    noteForm.text.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) noteForm.requestSubmit(); };
    d.onclick = async e => {
      if (e.target.closest('[data-close]')) return closeDrawer();
      const pay = e.target.closest('[data-pay]');
      if (pay) { e.preventDefault(); return openPayment(pay.dataset.pay, onChange); }
      const rec = e.target.closest('[data-receive]');
      if (rec) return receiveModal(lead.payments.find(p => p.id === rec.dataset.receive), after);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'transfer') transferModal([id], after);
      if (act === 'newpay') createPaymentModal({ leadId: id, onDone: after });
      if (act === 'delete' && await confirmBox(`${lead.name} o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.`, { ok: "O'chirish", danger: true })) {
        try { await leads.remove(id); toast("Lead o'chirildi"); changed(); closeDrawer(); onChange?.(); } catch (ex) { toast(ex.message, 'err'); }
      }
      if (act === 'tglink') {
        const url = await telegram.createLink(id);
        $('[data-link]', d).innerHTML = `<div class="link-box"><input class="inp" readonly value="${esc(url)}"><button class="btn sm" data-copy>Nusxa</button></div>`;
        $('[data-copy]', d).onclick = () => { navigator.clipboard?.writeText(url); toast('Havola nusxalandi'); };
      }
    };
  };
  await draw();
}
