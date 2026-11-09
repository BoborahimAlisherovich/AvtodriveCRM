// Demo adapter: ma'lumotlar brauzer xotirasida (localStorage). Supabase sozlanmagan
// bo'lsa ishlatiladi. Interfeysi supabase.js bilan bir xil.
import { db, byId, uid, persist, loadDb, resetDb } from './db.js';
import { me, can, setSession } from '../auth.js';
import { today, dayOf, fullName, normPhone, ACTIONS, PAY_STATUS, payStatus, ATT } from './common.js';

const now = () => new Date().toISOString();
const inRange = (date, f) => (!f.from || date >= f.from) && (!f.to || date <= f.to);
const copy = o => (o ? { ...o } : o);

function fail(msg) { throw new Error(msg); }
function deny() { fail("Bu amal uchun sizda ruxsat yo'q"); }
function need(action) { if (!can(action)) deny(); }

/* ---------------- sessiya ---------------- */
const SESSION = 'bxcrm.session';
export const mode = 'demo';

export function init() {
  loadDb();
  let id = null;
  try { id = localStorage.getItem(SESSION); } catch { /* ignore */ }
  const u = byId('profiles', id);
  setSession(u && u.active ? u : null, () => db.settings);
  return Promise.resolve(me());
}

export function signIn(idOrEmail) {
  const u = byId('profiles', idOrEmail) || db.profiles.find(p => p.email === String(idOrEmail).trim().toLowerCase());
  if (!u) return Promise.reject(new Error('Bunday login topilmadi'));
  if (!u.active) return Promise.reject(new Error('Bu xodim faolsizlantirilgan'));
  try { localStorage.setItem(SESSION, u.id); } catch { /* ignore */ }
  setSession(u, () => db.settings);
  return Promise.resolve(u);
}

export function signOut() {
  try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
  setSession(null);
  return Promise.resolve();
}

export function demoUsers() { return db.profiles.filter(p => p.active).map(copy); }
export function resetDemo() { resetDb(); }

function log(action, entity, entity_id, label, oldV = null, newV = null) {
  db.activity_logs.push({ id: uid('log'), user_id: me()?.id || null, action, entity, entity_id, label, old: oldV, new: newV, created_at: now() });
}

function notify(audience, recipient_id, recipient, kind, text) {
  db.notifications.push({
    id: uid('nf'), channel: 'telegram', audience, recipient_id, recipient, kind, text,
    status: 'queued', attempts: 0, error: '', created_at: now(),
  });
}

const done = v => { persist(); return Promise.resolve(v); };

/* ---------------- xodimlar ---------------- */
export function profileName(id) { return byId('profiles', id)?.full_name || '—'; }

export function isAtWork(profileId, date = today()) {
  const p = byId('profiles', profileId);
  if (!p || !p.active) return false;
  if (!db.settings.require_attendance) return true;
  const a = db.attendance.find(a => a.profile_id === profileId && a.date === date);
  return !!a && (a.status === 'ishda' || a.status === 'kechikdi');
}

function nextRoundRobin() {
  const s = db.settings;
  const order = s.rr_order.filter(id => byId('profiles', id)?.role === 'seller');
  if (!order.length) return null;
  const start = order.indexOf(s.rr_last);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(start + k + order.length) % order.length];
    if (isAtWork(id)) { s.rr_last = id; return id; }
  }
  return null;
}

export const staff = {
  list({ includeInactive = true } = {}) {
    return db.profiles.filter(p => includeInactive || p.active).map(copy);
  },
  sellers({ activeOnly = false } = {}) {
    return db.profiles.filter(p => p.role === 'seller' && (!activeOnly || p.active)).map(copy);
  },
  create(data) {
    need('staff.manage');
    if (!data.full_name?.trim()) fail('Ism familiyani kiriting');
    if (!data.email?.trim()) fail('Login (email) kiriting');
    if (db.profiles.some(p => p.email.toLowerCase() === data.email.trim().toLowerCase())) fail('Bu login band');
    const p = {
      id: uid('u'), full_name: data.full_name.trim(), phone: normPhone(data.phone), email: data.email.trim().toLowerCase(),
      role: data.role || 'seller', position: data.position || '', work_start: data.work_start || '09:00',
      work_end: data.work_end || '18:00', schedule: data.schedule || 'Du–Sha', birthday: data.birthday || null,
      active: true, telegram_chat_id: null, created_at: now(),
    };
    db.profiles.push(p);
    if (p.role === 'seller') db.settings.rr_order.push(p.id);
    log('staff.create', 'staff', p.id, p.full_name, null, p.role);
    return done(copy(p));
  },
  update(id, data) {
    need('staff.manage');
    const p = byId('profiles', id) || fail('Xodim topilmadi');
    const changed = {};
    for (const k of ['full_name', 'phone', 'email', 'role', 'position', 'work_start', 'work_end', 'schedule', 'birthday', 'active']) {
      if (!(k in data)) continue;
      let v = data[k];
      if (k === 'phone') v = normPhone(v);
      if (k === 'active') v = !!v;
      if (p[k] !== v) { changed[k] = [p[k], v]; p[k] = v; }
    }
    if (p.id === me().id && (p.role !== 'admin' || !p.active)) {
      for (const k in changed) p[k] = changed[k][0];
      fail("O'zingizning rolingizni yoki faolligingizni o'zgartira olmaysiz");
    }
    if (p.role === 'seller' && !db.settings.rr_order.includes(p.id)) db.settings.rr_order.push(p.id);
    if (p.role !== 'seller') db.settings.rr_order = db.settings.rr_order.filter(x => x !== p.id);
    if (Object.keys(changed).length) {
      log('staff.edit', 'staff', p.id, p.full_name,
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])),
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])));
    }
    return done(copy(p));
  },
};

/* ---------------- statuslar (Kanban bosqichlari) ---------------- */
export const stages = {
  list() { return [...db.lead_statuses].sort((a, b) => a.sort - b.sort).map(copy); },
  get(id) { return copy(byId('lead_statuses', id)); },
  create({ name, color }) {
    need('stages.manage');
    if (!name?.trim()) fail('Bosqich nomini kiriting');
    const list = stages.list();
    const before = list.find(s => s.kind === 'won') || list[list.length - 1];
    for (const s of db.lead_statuses) if (s.sort >= before.sort) s.sort++;
    const s = { id: uid('st'), name: name.trim(), color: color || '#2fc6f6', kind: null, sort: before.sort, is_system: false };
    db.lead_statuses.push(s);
    log('stage.create', 'stage', s.id, s.name);
    return done(copy(s));
  },
  update(id, { name, color }) {
    need('stages.manage');
    const s = byId('lead_statuses', id) || fail('Bosqich topilmadi');
    const old = s.name;
    if (name?.trim()) s.name = name.trim();
    if (color) s.color = color;
    log('stage.edit', 'stage', s.id, s.name, old, s.name);
    return done(copy(s));
  },
  move(id, dir) {
    need('stages.manage');
    const list = [...db.lead_statuses].sort((a, b) => a.sort - b.sort);
    const i = list.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return done();
    [list[i].sort, list[j].sort] = [list[j].sort, list[i].sort];
    return done();
  },
  remove(id) {
    need('stages.manage');
    const s = byId('lead_statuses', id) || fail('Bosqich topilmadi');
    if (s.is_system) fail("Tizim bosqichini o'chirib bo'lmaydi");
    const cnt = db.leads.filter(l => l.status_id === id).length;
    if (cnt) fail(`Bu bosqichda ${cnt} ta lead bor. Avval ularni boshqa bosqichga o'tkazing`);
    db.lead_statuses = db.lead_statuses.filter(x => x.id !== id);
    log('stage.delete', 'stage', id, s.name);
    return done();
  },
};

/* ---------------- kurslar ---------------- */
export const courses = {
  list({ includeInactive = false } = {}) {
    return db.courses.filter(c => includeInactive || c.active).map(copy);
  },
  save(data) {
    need('courses.manage');
    if (!data.name?.trim()) fail('Kurs nomini kiriting');
    const fields = {
      name: data.name.trim(), description: data.description || '', price: Number(data.price) || 0,
      duration: data.duration || '', schedule: data.schedule || '', topics: data.topics || '', teacher: data.teacher || '',
    };
    if (data.id) {
      const c = byId('courses', data.id) || fail('Kurs topilmadi');
      Object.assign(c, fields);
      log('course.edit', 'course', c.id, c.name);
      return done(copy(c));
    }
    const c = { id: uid('c'), ...fields, active: true, created_at: now() };
    db.courses.push(c);
    log('course.create', 'course', c.id, c.name);
    return done(copy(c));
  },
  toggle(id) {
    need('courses.manage');
    const c = byId('courses', id) || fail('Kurs topilmadi');
    c.active = !c.active;
    log('course.edit', 'course', c.id, c.name, c.active ? 'Nofaol' : 'Faol', c.active ? 'Faol' : 'Nofaol');
    return done(copy(c));
  },
};

/* ---------------- to'lov holati hisoblash ---------------- */
function leadPayMap() {
  const t = today();
  const m = new Map();
  for (const p of db.payments) {
    const s = payStatus(p, t);
    if (s === 'bekor') continue;
    const prev = m.get(p.lead_id);
    if (!prev || s === 'qarzdor' || (s === 'boshlangich' && prev === 'tolangan')) m.set(p.lead_id, s);
  }
  return m;
}

/* ---------------- leadlar ---------------- */
function visibleLeads() {
  if (can('leads.all')) return db.leads;
  const u = me();
  return db.leads.filter(l => l.owner_id === u.id);
}

function leadOf(id) {
  const l = byId('leads', id) || fail('Lead topilmadi');
  if (!can('leads.all') && l.owner_id !== me().id) deny();
  return l;
}

function decorateLead(l, payMap) {
  return {
    ...l,
    name: fullName(l),
    owner_name: l.owner_id ? profileName(l.owner_id) : '',
    transferred_from_name: l.transferred_from ? profileName(l.transferred_from) : '',
    status: byId('lead_statuses', l.status_id),
    course_name: byId('courses', l.course_id)?.name || '',
    pay_status: payMap ? payMap.get(l.id) || '' : '',
  };
}

function filterLeads(f = {}) {
  let rows = visibleLeads();
  const q = (f.q || '').trim().toLowerCase();
  if (q) {
    const qd = q.replace(/\D/g, '');
    rows = rows.filter(l => {
      const a = `${l.first_name} ${l.last_name}`.toLowerCase();
      const b = `${l.last_name} ${l.first_name}`.toLowerCase();
      return a.includes(q) || b.includes(q) || (qd.length >= 3 && l.phone.includes(qd));
    });
  }
  if (f.owner) rows = rows.filter(l => (f.owner === 'none' ? !l.owner_id : l.owner_id === f.owner));
  if (f.status) rows = rows.filter(l => l.status_id === f.status);
  if (f.source) rows = rows.filter(l => l.source === f.source);
  if (f.course) rows = rows.filter(l => l.course_id === f.course);
  if (f.from || f.to) rows = rows.filter(l => inRange(dayOf(l.created_at), f));
  const payMap = leadPayMap();
  if (f.pay) rows = rows.filter(l => (f.pay === 'none' ? !payMap.has(l.id) : payMap.get(l.id) === f.pay));
  rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { rows, payMap };
}

export const leads = {
  query(f = {}) {
    const { rows, payMap } = filterLeads(f);
    const size = f.size || 50;
    const page = Math.max(1, f.page || 1);
    return Promise.resolve({
      total: rows.length,
      rows: rows.slice((page - 1) * size, page * size).map(l => decorateLead(l, payMap)),
    });
  },
  // Excel eksport uchun filtrlangan barcha qatorlar
  all(f = {}) {
    const { rows, payMap } = filterLeads(f);
    return Promise.resolve(rows.map(l => decorateLead(l, payMap)));
  },
  kanban(f = {}, limits = {}) {
    const { rows, payMap } = filterLeads({ ...f, status: '' });
    const by = new Map();
    // oxirgi o'tkazilgan (yoki qo'shilgan) lead ustun boshida turadi
    // bosqichga o'tkazilgan yoki boshqa sotuvchiga o'tkazilgan — qaysi biri keyinroq bo'lsa
    const moved = l => [l.status_changed_at || l.created_at, l.transferred_at || ''].sort().at(-1);
    for (const l of [...rows].sort((a, b) => moved(b).localeCompare(moved(a)))) {
      if (!by.has(l.status_id)) by.set(l.status_id, []);
      by.get(l.status_id).push(l);
    }
    return Promise.resolve(stages.list().map(s => {
      const list = by.get(s.id) || [];
      return { stage: s, total: list.length, rows: list.slice(0, limits[s.id] || 30).map(l => decorateLead(l, payMap)) };
    }));
  },
  get(id) {
    const l = leadOf(id);
    const t = today();
    const lead = decorateLead(l, leadPayMap());
    lead.notes = db.lead_notes.filter(n => n.lead_id === id)
      .map(n => ({ ...n, author: profileName(n.author_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    lead.assignments = db.lead_assignments.filter(a => a.lead_id === id)
      .map(a => ({ ...a, from: a.from_id ? profileName(a.from_id) : '', to: a.to_id ? profileName(a.to_id) : '—', by: a.by_id ? profileName(a.by_id) : 'Tizim' }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    lead.payments = db.payments.filter(p => p.lead_id === id).map(p => decoratePayment(p, t));
    lead.logs = db.activity_logs.filter(a => a.entity === 'lead' && a.entity_id === id)
      .map(a => ({ ...a, user: a.user_id ? profileName(a.user_id) : 'Tizim' }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return Promise.resolve(lead);
  },
  findByPhone(phone) {
    const p = normPhone(phone);
    const l = db.leads.find(x => x.phone === p);
    return l ? { id: l.id, name: fullName(l), owner: profileName(l.owner_id), visible: can('leads.all') || l.owner_id === me().id } : null;
  },
  create(data) {
    const u = me();
    if (!data.first_name?.trim()) fail('Ismni kiriting');
    const phone = normPhone(data.phone);
    if (phone.length < 13) fail("Telefon raqami to'liq emas (+998 XX XXX XX XX)");
    const dup = leads.findByPhone(phone);
    if (dup) fail(`Bu raqam bazada bor: ${dup.name} (mas'ul: ${dup.owner})`);
    let owner = null;
    let reason;
    if (u.role === 'seller') { owner = u.id; reason = "O'zi qo'shdi"; }
    else if (data.owner_id && data.owner_id !== 'auto') { owner = data.owner_id; reason = "Qo'lda biriktirildi"; }
    else { owner = nextRoundRobin(); reason = 'Avtomatik taqsimot (Round Robin)'; }
    const first = stages.list()[0];
    const l = {
      id: uid('l'), first_name: data.first_name.trim(), last_name: (data.last_name || '').trim(), phone,
      source: data.source || "Qo'lda kiritish", owner_id: owner, status_id: first.id, course_id: data.course_id || null,
      created_at: now(), status_changed_at: null, next_contact_at: data.next_contact_at ? new Date(data.next_contact_at).toISOString() : null,
      comment: data.comment || '', birthday: data.birthday || null, telegram_chat_id: null, created_by: u.id,
    };
    db.leads.push(l);
    db.lead_assignments.push({ id: uid('as'), lead_id: l.id, from_id: null, to_id: owner, by_id: u.id, reason, created_at: l.created_at });
    log('lead.create', 'lead', l.id, fullName(l), null, l.source);
    if (owner && owner !== u.id) notify('staff', owner, profileName(owner), 'lead.assigned', `Sizga yangi lead biriktirildi: ${fullName(l)}`);
    return done(decorateLead(l));
  },
  update(id, data) {
    const l = leadOf(id);
    const oldV = {}, newV = {};
    for (const k of ['first_name', 'last_name', 'phone', 'source', 'course_id', 'next_contact_at', 'comment', 'birthday']) {
      if (!(k in data)) continue;
      let v = data[k] || null;
      if (k === 'phone') {
        v = normPhone(v);
        if (v.length < 13) fail("Telefon raqami to'liq emas");
        const dup = db.leads.find(x => x.phone === v && x.id !== id);
        if (dup) fail(`Bu raqam boshqa leadda bor: ${fullName(dup)}`);
      }
      if (k === 'first_name' && !v) fail('Ism bo\'sh bo\'lmasin');
      if (k === 'next_contact_at' && v) v = new Date(v).toISOString();
      if ((l[k] || null) !== v) { oldV[k] = l[k]; newV[k] = v; l[k] = v ?? (k === 'comment' || k === 'last_name' ? '' : null); }
    }
    if (Object.keys(newV).length) log('lead.edit', 'lead', id, fullName(l), oldV, newV);
    return done(decorateLead(l));
  },
  setStatus(id, statusId) {
    const l = leadOf(id);
    const s = byId('lead_statuses', statusId) || fail('Status topilmadi');
    if (l.status_id === statusId) return done(decorateLead(l));
    const old = byId('lead_statuses', l.status_id)?.name;
    l.status_id = statusId;
    l.status_changed_at = now();
    // yangi egasi leadni harakatga keltirdi — "Sizga o'tkazilgan" belgisi olinadi
    if (l.transfer_new && l.owner_id === me()?.id) l.transfer_new = false;
    log('lead.status', 'lead', id, fullName(l), old, s.name);
    return done(decorateLead(l));
  },
  addNote(id, text) {
    const l = leadOf(id);
    if (!text?.trim()) fail('Izoh matnini yozing');
    db.lead_notes.push({ id: uid('nt'), lead_id: id, author_id: me().id, text: text.trim(), created_at: now() });
    log('lead.note', 'lead', id, fullName(l), null, text.trim().slice(0, 120));
    return done();
  },
  transfer(ids, toId, reason) {
    need('leads.transfer');
    const u = me();
    const to = byId('profiles', toId) || fail('Sotuvchini tanlang');
    if (!to.active) fail("Nofaol xodimga lead o'tkazib bo'lmaydi");
    if (!reason?.trim()) fail("O'tkazish sababini yozing");
    if (ids.length > 1) need('leads.bulk');
    let n = 0;
    for (const id of ids) {
      const l = leadOf(id);
      if (l.owner_id === toId) continue;
      const from = l.owner_id;
      l.owner_id = toId;
      if (from) Object.assign(l, { transferred_from: from, transferred_at: now(), transfer_reason: reason.trim(), transfer_new: true });
      db.lead_assignments.push({ id: uid('as'), lead_id: id, from_id: from, to_id: toId, by_id: u.id, reason: reason.trim(), created_at: now() });
      log(from ? 'lead.transfer' : 'lead.assign', 'lead', id, fullName(l), from, toId);
      n++;
    }
    if (n) notify('staff', toId, to.full_name, 'lead.transferred', `Sizga ${n} ta lead o'tkazildi (${u.full_name}): ${reason.trim()}`);
    return done(n);
  },
  remove(id) {
    need('leads.delete');
    const l = leadOf(id);
    if (db.payments.some(p => p.lead_id === id)) fail("Bu leadda to'lovlar bor. O'chirish mumkin emas");
    db.leads = db.leads.filter(x => x.id !== id);
    db.lead_notes = db.lead_notes.filter(x => x.lead_id !== id);
    log('lead.delete', 'lead', id, fullName(l));
    return done();
  },
  // Sotuvchi boshqaga yo'naltirgan leadlari (faqat holatini ko'radi)
  transferredByMe() {
    const u = me();
    const seen = new Set();
    const out = [];
    const list = db.lead_assignments.filter(a => a.from_id === u.id && a.by_id === u.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const a of list) {
      if (seen.has(a.lead_id)) continue;
      seen.add(a.lead_id);
      const l = byId('leads', a.lead_id);
      if (!l) continue;
      out.push({ id: l.id, name: fullName(l), to: profileName(a.to_id), owner: profileName(l.owner_id), status: byId('lead_statuses', l.status_id), at: a.created_at, reason: a.reason });
    }
    return out;
  },
  importRows(rows, { ownerMode = 'auto', ownerId = null } = {}) {
    need('leads.import');
    const u = me();
    const sellers = db.profiles.filter(p => p.role === 'seller');
    const findSeller = name => {
      const n = String(name || '').toLowerCase().replace(/[‘’'`ʻ]/g, '').trim();
      if (!n) return null;
      return sellers.find(s => s.full_name.toLowerCase().replace(/[‘’'`ʻ]/g, '').includes(n) || n.includes(s.full_name.toLowerCase().replace(/[‘’'`ʻ]/g, '')))?.id || null;
    };
    const res = { added: 0, duplicates: 0, invalid: 0 };
    const phones = new Set(db.leads.map(l => l.phone));
    const first = stages.list()[0];
    for (const r of rows) {
      const phone = normPhone(r.phone);
      if (phone.length < 12 || !(r.first_name || r.last_name)) { res.invalid++; continue; }
      if (phones.has(phone)) { res.duplicates++; continue; }
      phones.add(phone);
      let owner = null;
      if (ownerMode === 'one') owner = ownerId;
      else if (ownerMode === 'column') owner = findSeller(r.owner);
      else if (ownerMode === 'auto') owner = nextRoundRobin();
      const course = r.course ? db.courses.find(c => c.name.toLowerCase().includes(String(r.course).toLowerCase()))?.id : null;
      let created = now();
      if (r.date) { const d = new Date(r.date); if (!isNaN(d)) created = d.toISOString(); }
      const l = {
        id: uid('l'), first_name: String(r.first_name || '').trim(), last_name: String(r.last_name || '').trim(), phone,
        source: r.source || 'Excel import', owner_id: owner, status_id: first.id, course_id: course || null,
        created_at: created, next_contact_at: null, comment: String(r.comment || ''), birthday: null, telegram_chat_id: null, created_by: u.id,
      };
      db.leads.push(l);
      db.lead_assignments.push({ id: uid('as'), lead_id: l.id, from_id: null, to_id: owner, by_id: u.id, reason: 'Excel import', created_at: now() });
      res.added++;
    }
    log('lead.import', 'lead', null, `${res.added} ta lead`, null, `qo'shildi: ${res.added}, takroriy: ${res.duplicates}, xato: ${res.invalid}`);
    return done(res);
  },
};

/* ---------------- to'lovlar ---------------- */
function decoratePayment(p, t = today()) {
  const l = byId('leads', p.lead_id);
  return {
    ...p,
    lead_name: l ? fullName(l) : '—',
    phone: l?.phone || '',
    owner_id: l?.owner_id || null,
    owner_name: l ? profileName(l.owner_id) : '',
    course_name: byId('courses', p.course_id)?.name || '',
    remaining: Math.max(0, p.total - p.paid),
    status: payStatus(p, t),
    due: p.next_date || p.due_date,
  };
}

function visiblePayments() {
  if (can('payments.all')) return db.payments;
  const u = me();
  return db.payments.filter(p => byId('leads', p.lead_id)?.owner_id === u.id);
}

function paymentOf(id) {
  const p = byId('payments', id) || fail("To'lov topilmadi");
  if (!can('payments.all') && byId('leads', p.lead_id)?.owner_id !== me().id) deny();
  return p;
}

function filterPayments(f = {}) {
  const t = today();
  let rows = visiblePayments().map(p => decoratePayment(p, t));
  const q = (f.q || '').trim().toLowerCase();
  if (q) {
    const qd = q.replace(/\D/g, '');
    rows = rows.filter(p => p.lead_name.toLowerCase().includes(q) || (qd.length >= 3 && p.phone.includes(qd)));
  }
  if (f.status) rows = rows.filter(p => p.status === f.status);
  if (f.owner) rows = rows.filter(p => p.owner_id === f.owner);
  if (f.course) rows = rows.filter(p => p.course_id === f.course);
  if (f.from || f.to) rows = rows.filter(p => inRange(dayOf(p.created_at), f));
  const rank = { qarzdor: 0, boshlangich: 1, tolangan: 2, bekor: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.due || '').localeCompare(b.due || ''));
  return rows;
}

export const payments = {
  list(f = {}) {
    const rows = filterPayments(f);
    const active = rows.filter(p => p.status !== 'bekor');
    const totals = {
      total: active.reduce((s, p) => s + p.total, 0),
      paid: active.reduce((s, p) => s + p.paid, 0),
      remaining: active.reduce((s, p) => s + p.remaining, 0),
      debt: active.filter(p => p.status === 'qarzdor').reduce((s, p) => s + p.remaining, 0),
      debtors: active.filter(p => p.status === 'qarzdor').length,
    };
    const size = f.size || 50;
    const page = Math.max(1, f.page || 1);
    return Promise.resolve({ total: rows.length, totals, rows: rows.slice((page - 1) * size, page * size), all: rows });
  },
  get(id) {
    const p = decoratePayment(paymentOf(id));
    p.history = db.payment_history.filter(h => h.payment_id === id)
      .map(h => ({ ...h, user: profileName(h.user_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return Promise.resolve(p);
  },
  create(data) {
    need('payments.create');
    const l = leadOf(data.lead_id);
    const total = Number(data.total);
    const paid = Number(data.paid || 0);
    if (!(total > 0)) fail('Umumiy summani kiriting');
    if (paid < 0 || paid > total) fail("Boshlang'ich to'lov umumiy summadan oshmasin");
    if (!data.due_date) fail("To'lov muddatini belgilang");
    const p = {
      id: uid('p'), lead_id: l.id, course_id: data.course_id || l.course_id || null, total, paid,
      due_date: data.due_date, next_date: paid < total ? (data.next_date || data.due_date) : null, note: data.note || '',
      cancelled: false, cancel_reason: '', created_by: me().id, created_at: now(),
    };
    db.payments.push(p);
    db.payment_history.push({ id: uid('ph'), payment_id: p.id, user_id: me().id, action: 'create', amount: total, old: null, new: null, note: p.note, created_at: p.created_at });
    if (paid > 0) db.payment_history.push({ id: uid('ph'), payment_id: p.id, user_id: me().id, action: 'pay', amount: paid, old: null, new: null, note: "Boshlang'ich to'lov", created_at: p.created_at });
    log('pay.create', 'payment', p.id, fullName(l), null, total);
    if (paid > 0) notify('client', l.id, fullName(l), 'pay.received', `To'lovingiz qabul qilindi: ${paid.toLocaleString('ru-RU')} so'm. Rahmat!`);
    return done(decoratePayment(p));
  },
  // Qo'shimcha to'lov qabul qilish — yangi yozuv qo'shiladi, eskisi o'zgarmaydi
  receive(id, { amount, next_date, note }) {
    need('payments.receive');
    const p = paymentOf(id);
    if (p.cancelled) fail("Bekor qilingan to'lovga pul qabul qilib bo'lmaydi");
    const a = Number(amount);
    const rem = p.total - p.paid;
    if (!(a > 0)) fail('Summani kiriting');
    if (a > rem) fail(`Qolgan summa ${rem.toLocaleString('ru-RU')} so'm. Undan ko'p kiritib bo'lmaydi`);
    p.paid += a;
    if (p.paid < p.total && next_date) p.next_date = next_date;
    if (p.paid >= p.total) p.next_date = null;
    db.payment_history.push({ id: uid('ph'), payment_id: id, user_id: me().id, action: 'pay', amount: a, old: null, new: null, note: note || '', created_at: now() });
    const l = byId('leads', p.lead_id);
    log('pay.receive', 'payment', id, fullName(l), null, a);
    notify('client', l.id, fullName(l), 'pay.received', `To'lovingiz qabul qilindi: ${a.toLocaleString('ru-RU')} so'm. Rahmat!`);
    return done(decoratePayment(p));
  },
  update(id, data) {
    need('payments.edit');
    const p = paymentOf(id);
    const oldV = {}, newV = {};
    for (const k of ['total', 'paid', 'due_date', 'next_date', 'note', 'course_id']) {
      if (!(k in data)) continue;
      let v = data[k];
      if (k === 'total' || k === 'paid') v = Number(v);
      if (k === 'next_date' || k === 'course_id') v = v || null;
      if (p[k] !== v) { oldV[k] = p[k]; newV[k] = v; }
    }
    const total = 'total' in newV ? newV.total : p.total;
    const paid = 'paid' in newV ? newV.paid : p.paid;
    if (!(total > 0)) fail("Umumiy summa noto'g'ri");
    if (paid < 0 || paid > total) fail("To'langan summa umumiy summadan oshmasin");
    if (!Object.keys(newV).length) return done(decoratePayment(p));
    Object.assign(p, newV);
    db.payment_history.push({ id: uid('ph'), payment_id: id, user_id: me().id, action: 'edit', amount: null, old: oldV, new: newV, note: data.reason || '', created_at: now() });
    log('pay.edit', 'payment', id, fullName(byId('leads', p.lead_id)), oldV, newV);
    return done(decoratePayment(p));
  },
  cancel(id, reason) {
    need('payments.edit');
    const p = paymentOf(id);
    if (!reason?.trim()) fail('Bekor qilish sababini yozing');
    p.cancelled = true;
    p.cancel_reason = reason.trim();
    db.payment_history.push({ id: uid('ph'), payment_id: id, user_id: me().id, action: 'cancel', amount: null, old: null, new: null, note: reason.trim(), created_at: now() });
    log('pay.cancel', 'payment', id, fullName(byId('leads', p.lead_id)), null, reason.trim());
    return done(decoratePayment(p));
  },
};

/* ---------------- davomat ---------------- */

export const attendance = {
  day(date) {
    need('attendance.view');
    return db.profiles.map(p => {
      const a = db.attendance.find(a => a.profile_id === p.id && a.date === date);
      return { profile: copy(p), status: a?.status || '', note: a?.note || '', in_rr: p.role === 'seller' && date === today() && isAtWork(p.id, date) };
    });
  },
  todayStatus(profileId) {
    return db.attendance.find(a => a.profile_id === profileId && a.date === today())?.status || '';
  },
  set(profileId, date, status, note = '') {
    need('attendance.edit');
    const p = byId('profiles', profileId) || fail('Xodim topilmadi');
    let a = db.attendance.find(a => a.profile_id === profileId && a.date === date);
    const old = a?.status || '';
    if (!a) { a = { id: uid('at'), profile_id: profileId, date }; db.attendance.push(a); }
    Object.assign(a, { status, note, updated_by: me().id, updated_at: now() });
    if (old !== status) log('att.set', 'attendance', a.id, `${p.full_name} — ${date}`, ATT[old]?.name || '', ATT[status]?.name || '');
    return done();
  },
  month(ym) {
    need('attendance.view');
    return db.profiles.map(p => {
      const c = { ishda: 0, kechikdi: 0, kelmadi: 0, ruxsat: 0, dam: 0 };
      for (const a of db.attendance) if (a.profile_id === p.id && a.date.startsWith(ym) && c[a.status] !== undefined) c[a.status]++;
      return { profile: copy(p), ...c };
    });
  },
};

/* ---------------- statistika ---------------- */
function revenueByLead(f) {
  const m = new Map();
  for (const h of db.payment_history) {
    if (h.action !== 'pay' || !inRange(dayOf(h.created_at), f)) continue;
    const p = byId('payments', h.payment_id);
    if (!p || p.cancelled) continue;
    m.set(p.lead_id, (m.get(p.lead_id) || 0) + h.amount);
  }
  return m;
}

function leadStats(list) {
  const kind = l => byId('lead_statuses', l.status_id)?.kind;
  const won = list.filter(l => kind(l) === 'won').length;
  const lost = list.filter(l => kind(l) === 'lost').length;
  const unanswered = list.filter(l => kind(l) === 'new' || kind(l) === 'noanswer').length;
  return { leads: list.length, won, lost, unanswered, worked: list.length - unanswered, conversion: list.length ? won / list.length * 100 : 0 };
}

export const reports = {
  sellers(f = {}) {
    need('reports.view');
    const rev = revenueByLead(f);
    return db.profiles.filter(p => p.role === 'seller').map(s => {
      const own = db.leads.filter(l => l.owner_id === s.id && inRange(dayOf(l.created_at), f));
      const asg = db.lead_assignments.filter(a => inRange(dayOf(a.created_at), f));
      let revenue = 0;
      for (const l of db.leads) if (l.owner_id === s.id) revenue += rev.get(l.id) || 0;
      return {
        seller: copy(s),
        received: asg.filter(a => a.to_id === s.id).length,
        ...leadStats(own),
        sentOut: asg.filter(a => a.from_id === s.id && a.to_id).length,
        receivedIn: asg.filter(a => a.to_id === s.id && a.from_id).length,
        revenue,
      };
    });
  },
};

export const dashboard = {
  summary(f = {}) {
    const u = me();
    const scoped = visibleLeads();
    const t = today();
    const inPeriod = scoped.filter(l => inRange(dayOf(l.created_at), f));
    const st = leadStats(inPeriod);
    const rev = revenueByLead(f);
    let revenue = 0;
    for (const l of scoped) revenue += rev.get(l.id) || 0;
    const pays = visiblePayments().map(p => decoratePayment(p, t)).filter(p => p.status !== 'bekor');
    const expected = pays.filter(p => p.status === 'boshlangich').reduce((s, p) => s + p.remaining, 0);
    const debt = pays.filter(p => p.status === 'qarzdor').reduce((s, p) => s + p.remaining, 0);
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    const calls = scoped.filter(l => l.next_contact_at && new Date(l.next_contact_at) <= endOfToday && !['won', 'lost'].includes(byId('lead_statuses', l.status_id)?.kind))
      .sort((a, b) => a.next_contact_at.localeCompare(b.next_contact_at)).map(l => decorateLead(l));
    const fresh = scoped.filter(l => byId('lead_statuses', l.status_id)?.kind === 'new').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map(l => decorateLead(l));
    const debtors = pays.filter(p => p.status === 'qarzdor').sort((a, b) => b.remaining - a.remaining).slice(0, 6);
    const todayLeads = scoped.filter(l => dayOf(l.created_at) === t).length;
    const out = { ...st, revenue, expected, debt, calls: calls.slice(0, 10), callsTotal: calls.length, fresh, debtors, todayLeads, totalLeads: scoped.length };
    if (u.role !== 'seller') {
      out.sellers = db.profiles.filter(p => p.role === 'seller').map(s => {
        const own = inPeriod.filter(l => l.owner_id === s.id);
        let r = 0;
        for (const l of db.leads) if (l.owner_id === s.id) r += rev.get(l.id) || 0;
        return { seller: copy(s), ...leadStats(own), revenue: r, att: attendance.todayStatus(s.id), in_rr: isAtWork(s.id) };
      });
      out.staffToday = db.profiles.map(p => ({ profile: copy(p), att: attendance.todayStatus(p.id) }));
    }
    return Promise.resolve(out);
  },
};

/* ---------------- activity log ---------------- */
export const logs = {
  list(f = {}) {
    let rows = db.activity_logs;
    if (!can('logs.all')) rows = rows.filter(r => r.user_id === me().id);
    if (f.user) rows = rows.filter(r => (f.user === 'system' ? !r.user_id : r.user_id === f.user));
    if (f.action) rows = rows.filter(r => r.action.startsWith(f.action));
    if (f.from || f.to) rows = rows.filter(r => inRange(dayOf(r.created_at), f));
    const q = (f.q || '').trim().toLowerCase();
    if (q) rows = rows.filter(r => (r.label || '').toLowerCase().includes(q));
    rows = [...rows].reverse();
    const size = f.size || 50;
    const page = Math.max(1, f.page || 1);
    const dec = r => ({ ...r, user: r.user_id ? profileName(r.user_id) : 'Tizim', action_name: ACTIONS[r.action] || r.action });
    return Promise.resolve({ total: rows.length, rows: rows.slice((page - 1) * size, page * size).map(dec), all: () => rows.map(dec) });
  },
};

/* ---------------- telegram ---------------- */
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const telegram = {
  // Bir martalik token: bazada faqat hash saqlanadi, 24 soat amal qiladi
  async createLink(leadId) {
    const l = leadOf(leadId);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    db.telegram_links.push({
      id: uid('tg'), lead_id: l.id, token_hash: await sha256(token),
      expires_at: new Date(Date.now() + 24 * 3600e3).toISOString(), used_at: null, created_by: me().id, created_at: now(),
    });
    log('tg.link', 'lead', l.id, fullName(l));
    persist();
    return `https://t.me/${db.settings.bot_username}?start=${token}`;
  },
  notifications(f = {}) {
    need('telegram.view');
    let rows = [...db.notifications].reverse();
    if (f.status) rows = rows.filter(r => r.status === f.status);
    if (f.audience) rows = rows.filter(r => r.audience === f.audience);
    return Promise.resolve(rows.slice(0, 300));
  },
};

/* ---------------- tashqi API — faqat Supabase rejimida ---------------- */
export const integrations = { available: false };

/* ---------------- sozlamalar ---------------- */
export const settings = {
  get() { return JSON.parse(JSON.stringify(db.settings)); },
  save(patch) {
    need('settings.manage');
    const oldV = {}, newV = {};
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(db.settings[k]) !== JSON.stringify(v)) { oldV[k] = db.settings[k]; newV[k] = v; db.settings[k] = v; }
    }
    if (Object.keys(newV).length) log('settings.edit', 'settings', null, Object.keys(newV).join(', '), oldV, newV);
    return done();
  },
};

/* ---------------- to'liq zaxira (Excel) ---------------- */
export function backupTables() {
  need('export.all');
  return db;
}

/* ---------------- menyu belgilari ---------------- */
export function badges() {
  const rows = visibleLeads();
  return Promise.resolve({
    fresh: rows.filter(l => byId('lead_statuses', l.status_id)?.kind === 'new').length,
    debts: visiblePayments().filter(p => payStatus(p) === 'qarzdor').length,
  });
}
