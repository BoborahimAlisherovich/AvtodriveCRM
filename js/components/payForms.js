// To'lov oynalari: yaratish, pul qabul qilish, tahrirlash (faqat FULL ADMIN), bekor qilish, tarix.
import { payments, leads, courses, PAY_STATUS } from '../data/api.js';
import { can } from '../auth.js';
import { esc, money, num, fmtDate, fmtDT, modal, options, toast, badge, openDrawer, closeDrawer, icon, $ } from '../ui.js';

const changed = () => dispatchEvent(new Event('crm:changed'));

export async function createPaymentModal({ leadId, onDone } = {}) {
  const courseList = courses.list();
  let leadOpts = '';
  let lead = null;
  if (leadId) {
    lead = await leads.get(leadId);
  } else {
    const all = await leads.all({});
    const rank = l => (l.status?.kind === 'won' ? 0 : l.status_id === 'st_waitpay' ? 1 : 2);
    all.sort((a, b) => rank(a) - rank(b));
    leadOpts = all.map(l => `<option value="${l.id}" data-course="${l.course_id || ''}">${esc(l.name)} — ${esc(l.phone)}${l.status ? ' · ' + esc(l.status.name) : ''}</option>`).join('');
  }
  const startCourse = lead?.course_id || '';
  const price = courseList.find(c => c.id === startCourse)?.price || '';
  const due = new Date(); due.setDate(due.getDate() + 30);
  const dueStr = due.toISOString().slice(0, 10);
  return modal({
    title: "Yangi to'lov",
    submit: "To'lovni yaratish",
    body: `<div class="form-grid">
      ${lead ? `<div class="fld full"><label>Mijoz</label><div><b>${esc(lead.name)}</b> <span class="muted">${esc(lead.phone)}</span></div><input type="hidden" name="lead_id" value="${lead.id}"></div>`
        : `<div class="fld full"><label class="req">Mijoz</label><input class="inp" data-lead-filter placeholder="Ism yoki telefon bo'yicha filtrlash" style="width:100%;margin-bottom:6px"><select class="sel" name="lead_id" size="5" style="height:auto">${leadOpts}</select></div>`}
      <div class="fld full"><label>Toifa</label><select class="sel" name="course_id">${options(courseList.map(c => [c.id, `${c.name} — ${money(c.price)}`]), startCourse, { empty: '— tanlanmagan —' })}</select></div>
      <div class="fld"><label class="req">Umumiy summa</label><input class="inp" name="total" type="number" min="0" step="1000" value="${price}"></div>
      <div class="fld"><label>Boshlang'ich to'lov</label><input class="inp" name="paid" type="number" min="0" step="1000" value="0"></div>
      <div class="fld"><label>Qolgan summa</label><div data-rest class="money" style="padding-top:7px;font-weight:600">—</div></div>
      <div class="fld"><label class="req">To'lov muddati</label><input class="inp" name="due_date" type="date" value="${dueStr}"></div>
      <div class="fld"><label>Keyingi to'lov sanasi</label><input class="inp" name="next_date" type="date" value="${dueStr}"></div>
      <div class="fld full"><label>Izoh</label><textarea class="inp" name="note" rows="2"></textarea></div>
    </div>
    ${can('payments.edit') ? '' : `<p class="muted small" style="margin:12px 0 0">Yaratilgandan keyin summani va muddatni faqat FULL ADMIN o'zgartira oladi.</p>`}`,
    onMount(form) {
      const rest = $('[data-rest]', form);
      const calc = () => {
        const t = Number(form.total.value) || 0, p = Number(form.paid.value) || 0;
        rest.textContent = money(Math.max(0, t - p));
        rest.style.color = p > t ? '#e3413c' : '';
      };
      form.addEventListener('input', calc);
      form.course_id.addEventListener('change', () => {
        const c = courseList.find(c => c.id === form.course_id.value);
        if (c) { form.total.value = c.price; calc(); }
      });
      const filter = $('[data-lead-filter]', form);
      if (filter) {
        const sel = form.lead_id;
        const all = [...sel.options];
        filter.addEventListener('input', () => {
          const q = filter.value.toLowerCase().replace(/\s+/g, ' ');
          for (const o of all) o.hidden = q && !o.textContent.toLowerCase().includes(q);
        });
        sel.addEventListener('change', () => {
          const c = sel.selectedOptions[0]?.dataset.course;
          if (c) { form.course_id.value = c; form.course_id.dispatchEvent(new Event('change')); }
        });
      }
      calc();
    },
    async onSubmit(v) {
      if (!v.lead_id) throw new Error('Mijozni tanlang');
      const p = await payments.create(v);
      toast("To'lov yaratildi");
      changed();
      onDone?.(p);
      return p;
    },
  });
}

export function receiveModal(p, onDone) {
  return modal({
    title: "To'lov qabul qilish",
    submit: 'Qabul qilish',
    body: `<p style="margin:0 0 12px"><b>${esc(p.lead_name)}</b> · ${esc(p.course_name || '')}<br>
      <span class="muted">Umumiy: ${money(p.total)} · To'langan: ${money(p.paid)} · </span><b>Qolgan: ${money(p.remaining)}</b></p>
      <div class="form-grid">
        <div class="fld"><label class="req">Summa</label><input class="inp" name="amount" type="number" min="0" step="1000" max="${p.remaining}" value="${p.remaining}" autofocus></div>
        <div class="fld"><label>Keyingi to'lov sanasi</label><input class="inp" name="next_date" type="date" value="${esc(p.next_date || '')}"><div class="hint">Qarz qolsa to'ldiring</div></div>
        <div class="fld full"><label>Izoh</label><input class="inp" name="note" placeholder="Masalan: naqd, Click, Payme"></div>
      </div>`,
    async onSubmit(v) {
      const r = await payments.receive(p.id, v);
      toast(`${money(v.amount)} qabul qilindi`);
      changed();
      onDone?.(r);
      return r;
    },
  });
}

export function editModal(p, onDone) {
  const courseList = courses.list({ includeInactive: true });
  return modal({
    title: "To'lovni tahrirlash",
    submit: 'Saqlash',
    body: `<div class="info" style="margin-bottom:14px">Barcha o'zgarishlar to'lov tarixida va Activity Logda saqlanadi.</div>
      <div class="form-grid">
        <div class="fld full"><label>Toifa</label><select class="sel" name="course_id">${options(courseList.map(c => [c.id, c.name]), p.course_id, { empty: '—' })}</select></div>
        <div class="fld"><label class="req">Umumiy summa</label><input class="inp" name="total" type="number" min="0" step="1000" value="${p.total}"></div>
        <div class="fld"><label>To'langan summa</label><input class="inp" name="paid" type="number" min="0" step="1000" value="${p.paid}"></div>
        <div class="fld"><label class="req">To'lov muddati</label><input class="inp" name="due_date" type="date" value="${esc(p.due_date || '')}"></div>
        <div class="fld"><label>Keyingi to'lov sanasi</label><input class="inp" name="next_date" type="date" value="${esc(p.next_date || '')}"></div>
        <div class="fld full"><label>Izoh</label><input class="inp" name="note" value="${esc(p.note || '')}"></div>
        <div class="fld full"><label class="req">O'zgartirish sababi</label><input class="inp" name="reason"></div>
      </div>`,
    async onSubmit(v) {
      if (!v.reason.trim()) throw new Error("O'zgartirish sababini yozing");
      const r = await payments.update(p.id, v);
      toast("To'lov yangilandi");
      changed();
      onDone?.(r);
      return r;
    },
  });
}

export function cancelModal(p, onDone) {
  return modal({
    title: "To'lovni bekor qilish",
    submit: 'Bekor qilish',
    cancel: 'Orqaga',
    danger: true,
    body: `<p style="margin:0 0 12px">${esc(p.lead_name)} — ${money(p.total)}</p>
      <div class="fld"><label class="req">Sabab</label><textarea class="inp" name="reason" rows="2"></textarea></div>`,
    async onSubmit(v) {
      const r = await payments.cancel(p.id, v.reason);
      toast("To'lov bekor qilindi");
      changed();
      onDone?.(r);
      return r;
    },
  });
}

const HIST = { create: "To'lov yaratildi", pay: "Pul qabul qilindi", edit: 'Tahrirlandi', cancel: 'Bekor qilindi' };
const FIELD = { total: 'Umumiy summa', paid: "To'langan", due_date: 'Muddat', next_date: "Keyingi to'lov", note: 'Izoh', course_id: 'Toifa' };
function fmtVal(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'total' || k === 'paid') return money(v);
  if (k.endsWith('date')) return fmtDate(v);
  return String(v);
}

export async function openPayment(id, onChange) {
  const d = openDrawer();
  const draw = async () => {
    const p = await payments.get(id);
    const st = PAY_STATUS[p.status];
    d.innerHTML = `<div class="drawer-head"><div class="grow">
        <div class="muted small">To'lov</div><h2>${esc(p.lead_name)}</h2>
        <div style="margin-top:6px">${badge(st.name, st.color)} <span class="muted small">${esc(p.course_name)}</span></div>
      </div><button class="icon-btn" data-close>${icon('close')}</button></div>
      <div class="drawer-body">
        <div class="kpis" style="margin:0">
          <div class="kpi"><div class="t">Umumiy</div><div class="v money">${money(p.total)}</div></div>
          <div class="kpi" style="--c:var(--ok)"><div class="t">To'langan</div><div class="v money">${money(p.paid)}</div></div>
          <div class="kpi" style="--c:${p.status === 'qarzdor' ? 'var(--danger)' : 'var(--warn)'}"><div class="t">Qolgan</div><div class="v money">${money(p.remaining)}</div><div class="d">${p.due ? 'Muddat: ' + fmtDate(p.due) : ''}</div></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${p.status !== 'bekor' && p.remaining > 0 ? `<button class="btn primary" data-act="receive">${icon('money')} Pul qabul qilish</button>` : ''}
          ${can('payments.edit') && p.status !== 'bekor' ? `<button class="btn" data-act="edit">${icon('edit')} Tahrirlash</button><button class="btn danger" data-act="cancel">Bekor qilish</button>` : ''}
        </div>
        ${p.cancelled ? `<div class="info" style="background:#fff3f3;border-color:#ffc5c3;color:#a12b27">Bekor qilingan: ${esc(p.cancel_reason)}</div>` : ''}
        ${p.note ? `<div class="panel panel-pad"><div class="sec-title">Izoh</div><div class="note-text">${esc(p.note)}</div></div>` : ''}
        <div class="panel panel-pad"><div class="sec-title">To'lov tarixi</div><div class="timeline">
          ${p.history.map(h => `<div class="tl-item"><div class="tl-dot">${icon(h.action === 'pay' ? 'money' : h.action === 'edit' ? 'edit' : 'payments')}</div><div class="grow">
            <div><b>${HIST[h.action]}</b>${h.amount ? ` — ${h.action === 'pay' ? '<span class="green">+' + num(h.amount) + " so'm</span>" : money(h.amount)}` : ''}</div>
            ${h.action === 'edit' ? Object.keys(h.new || {}).map(k => `<div class="small">${FIELD[k] || k}: <s class="muted">${esc(fmtVal(k, h.old[k]))}</s> → <b>${esc(fmtVal(k, h.new[k]))}</b></div>`).join('') : ''}
            ${h.note ? `<div class="small muted">${esc(h.note)}</div>` : ''}
            <div class="meta">${fmtDT(h.created_at)} · ${esc(h.user)}</div></div></div>`).join('')}
        </div></div>
      </div>`;
    d.onclick = async e => {
      if (e.target.closest('[data-close]')) return closeDrawer();
      const act = e.target.closest('[data-act]')?.dataset.act;
      const after = () => { draw(); onChange?.(); };
      if (act === 'receive') receiveModal(p, after);
      if (act === 'edit') editModal(p, after);
      if (act === 'cancel') cancelModal(p, after);
    };
  };
  await draw();
}

