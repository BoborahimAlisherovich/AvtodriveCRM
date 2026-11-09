// Supabase adapter. Interfeysi demo.js bilan bir xil.
// O'qish: RLS bilan himoyalangan jadvallar/ko'rinishlar va RPC'lar.
// Yozish: faqat database funksiyalari (rolni server tekshiradi).
// Ma'lumotnomalar (xodimlar, bosqichlar, kurslar, sozlamalar, bugungi davomat) xotirada keshlanadi —
// shuning uchun sahifalar orasida o'tish tez.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { setSession, me } from '../auth.js';
import { today, fullName, ACTIONS as ACTION_NAMES } from './common.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
export const mode = 'supabase';

let sb = null;
const cache = { profiles: [], byId: new Map(), statuses: [], courses: [], settings: {}, att: new Map() };

// Avtomatik testlar o'z klientini ulashi uchun
export function _setClient(c) { sb = c; }

async function client() {
  if (!sb) {
    const { createClient } = await import(SDK);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return sb;
}

function friendly(err) {
  const m = err?.message || String(err);
  if (/permission denied|row-level security|42501/i.test(m) && !/ruxsat/.test(m)) return "Bu amal uchun sizda ruxsat yo'q";
  if (/JWT|refresh token/i.test(m)) return 'Sessiya tugadi. Qayta kiring';
  if (/Failed to fetch|NetworkError/i.test(m)) return "Server bilan aloqa yo'q. Internetni tekshiring";
  return m;
}
function check({ data, error }) {
  if (error) throw new Error(friendly(error));
  return data;
}
const rpc = async (name, args) => check(await sb.rpc(name, args));
const iso = v => (v ? new Date(v).toISOString() : '');
// Toshkent vaqti bo'yicha sana chegaralari
const dayStart = d => `${d}T00:00:00+05:00`;
const nextDay = d => { const x = new Date(`${d}T00:00:00+05:00`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString(); };

// Qidiruv matni: faqat raqamlar bo'lsa — telefon bo'yicha
function cleanFilters(f = {}) {
  const out = {};
  for (const k of ['owner', 'status', 'source', 'course', 'pay', 'from', 'to']) if (f[k]) out[k] = f[k];
  const q = (f.q || '').trim();
  if (q) out.q = /^[\d\s+()-]+$/.test(q) ? q.replace(/\D/g, '') : q.toLowerCase();
  return out;
}

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/* ---------------- kesh ---------------- */
async function loadProfiles() {
  cache.profiles = check(await sb.from('profiles').select('*').order('full_name'));
  cache.byId = new Map(cache.profiles.map(p => [p.id, p]));
}
async function loadStatuses() { cache.statuses = check(await sb.from('lead_statuses').select('*').order('sort')); }
async function loadCourses() { cache.courses = check(await sb.from('courses').select('*').order('name')); }
async function loadSettings() {
  cache.settings = Object.fromEntries(check(await sb.from('settings').select('key,value')).map(r => [r.key, r.value]));
}
async function loadAttendance() {
  cache.att = new Map(check(await sb.from('attendance').select('profile_id,status').eq('date', today())).map(a => [a.profile_id, a.status]));
}
async function loadAll() {
  await Promise.all([loadProfiles(), loadStatuses(), loadCourses(), loadSettings(), loadAttendance()]);
}

/* ---------------- sessiya ---------------- */
export async function init() {
  await client();
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) { setSession(null); return null; }
  const p = check(await sb.from('profiles').select('*').eq('id', uid).maybeSingle());
  if (!p || !p.active) { await sb.auth.signOut(); setSession(null); return null; }
  setSession(p, () => cache.settings);
  await loadAll();
  setSession(cache.byId.get(uid) || p, () => cache.settings);
  return me();
}

export async function signIn(email, password) {
  await client();
  const { error } = await sb.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? "Login yoki parol noto'g'ri" : friendly(error));
  const u = await init();
  if (!u) throw new Error('Hisobingiz faol emas. Administratorga murojaat qiling');
  return u;
}

export async function signOut() {
  await client();
  await sb.auth.signOut();
  setSession(null);
}

export const demoUsers = null;
export const resetDemo = null;

/* ---------------- yordamchi ---------------- */
export function profileName(id) { return cache.byId.get(id)?.full_name || '—'; }
const stageById = id => cache.statuses.find(s => s.id === id) || null;
const courseName = id => cache.courses.find(c => c.id === id)?.name || '';

function decorateLead(r) {
  return {
    ...r,
    name: fullName(r),
    owner_name: r.owner_id ? profileName(r.owner_id) : '',
    transferred_from_name: r.transferred_from ? profileName(r.transferred_from) : '',
    status: stageById(r.status_id),
    course_name: courseName(r.course_id),
    pay_status: r.pay_status || '',
  };
}
function decoratePayment(r) {
  return { ...r, owner_name: r.owner_id ? profileName(r.owner_id) : '', course_name: courseName(r.course_id) };
}

export function isAtWork(id) {
  const p = cache.byId.get(id);
  if (!p || !p.active) return false;
  if (cache.settings.require_attendance === false) return true;
  return ['ishda', 'kechikdi'].includes(cache.att.get(id));
}

export async function badges() { return rpc('badges'); }

/* ---------------- leadlar ---------------- */
export const leads = {
  async query(f = {}) {
    const r = await rpc('leads_search', { f: cleanFilters(f), p_page: f.page || 1, p_size: f.size || 50 });
    return { total: r.total, rows: r.rows.map(decorateLead) };
  },
  async all(f = {}) {
    const r = await rpc('leads_search', { f: cleanFilters(f), p_page: 1, p_size: 100000 });
    return r.rows.map(decorateLead);
  },
  async kanban(f = {}, limits = {}) {
    const cols = await rpc('leads_kanban', { f: cleanFilters(f), p_limits: limits });
    return cols.map(c => ({ stage: stageById(c.stage_id), total: c.total, rows: c.rows.map(decorateLead) })).filter(c => c.stage);
  },
  async get(id) {
    const [lead, notes, asg, pays, logs] = await Promise.all([
      sb.from('leads_v').select('*').eq('id', id).maybeSingle(),
      sb.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('lead_assignments').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('payments_v').select('*').eq('lead_id', id).order('created_at'),
      sb.from('activity_logs').select('*').eq('entity', 'lead').eq('entity_id', id).order('created_at', { ascending: false }).limit(200),
    ]);
    const l = check(lead);
    if (!l) throw new Error('Lead topilmadi yoki sizga biriktirilmagan');
    return {
      ...decorateLead(l),
      notes: check(notes).map(n => ({ ...n, author: profileName(n.author_id) })),
      assignments: check(asg).map(a => ({ ...a, from: a.from_id ? profileName(a.from_id) : '', to: a.to_id ? profileName(a.to_id) : '—', by: a.by_id ? profileName(a.by_id) : 'Tizim' })),
      payments: check(pays).map(decoratePayment),
      logs: check(logs).map(a => ({ ...a, user: a.user_id ? profileName(a.user_id) : 'Tizim' })),
    };
  },
  async findByPhone(phone) { return rpc('find_lead_by_phone', { p_phone: phone }); },
  async create(data) {
    const id = await rpc('create_lead', { p: { ...data, next_contact_at: iso(data.next_contact_at) } });
    const row = check(await sb.from('leads_v').select('*').eq('id', id).maybeSingle());
    return row ? decorateLead(row) : { id, owner_id: null };
  },
  async update(id, data) {
    const p = { ...data };
    if ('next_contact_at' in p) p.next_contact_at = iso(p.next_contact_at);
    await rpc('update_lead', { p_id: id, p });
  },
  async setStatus(id, statusId) { await rpc('set_lead_status', { p_id: id, p_status: statusId }); },
  async addNote(id, text) { await rpc('add_lead_note', { p_id: id, p_text: text }); },
  async transfer(ids, toId, reason) { return rpc('transfer_leads', { p_ids: ids, p_to: toId || null, p_reason: reason }); },
  async remove(id) { await rpc('delete_lead', { p_id: id }); },
  async transferredByMe() {
    const rows = await rpc('my_transferred_leads');
    return rows.map(r => ({ ...r, to: profileName(r.to_id), owner: profileName(r.owner_id), status: stageById(r.status_id) }));
  },
  async importRows(rows, { ownerMode = 'auto', ownerId = null } = {}) {
    const res = { added: 0, duplicates: 0, invalid: 0 };
    for (let i = 0; i < rows.length; i += 500) {
      const r = await rpc('import_leads', { p_rows: rows.slice(i, i + 500), p_mode: ownerMode, p_owner: ownerId || null });
      res.added += r.added; res.duplicates += r.duplicates; res.invalid += r.invalid;
    }
    return res;
  },
};

/* ---------------- bosqichlar ---------------- */
export const stages = {
  list() { return cache.statuses.map(s => ({ ...s })); },
  get(id) { const s = stageById(id); return s ? { ...s } : null; },
  async create({ name, color }) { const id = await rpc('stage_create', { p_name: name, p_color: color }); await loadStatuses(); return stageById(id); },
  async update(id, { name, color }) { await rpc('stage_update', { p_id: id, p_name: name, p_color: color }); await loadStatuses(); },
  async move(id, dir) { await rpc('stage_move', { p_id: id, p_dir: dir }); await loadStatuses(); },
  async remove(id) { await rpc('stage_delete', { p_id: id }); await loadStatuses(); },
};

/* ---------------- kurslar ---------------- */
export const courses = {
  list({ includeInactive = false } = {}) { return cache.courses.filter(c => includeInactive || c.active).map(c => ({ ...c })); },
  async save(data) { await rpc('course_save', { p: data }); await loadCourses(); },
  async toggle(id) { await rpc('course_toggle', { p_id: id }); await loadCourses(); },
};

/* ---------------- xodimlar ---------------- */
export const staff = {
  list({ includeInactive = true } = {}) { return cache.profiles.filter(p => includeInactive || p.active).map(p => ({ ...p })); },
  sellers({ activeOnly = false } = {}) { return cache.profiles.filter(p => p.role === 'seller' && (!activeOnly || p.active)).map(p => ({ ...p })); },
  async create(data) {
    const { data: res, error } = await sb.functions.invoke('invite-staff', { body: { ...data, redirect_to: location.origin } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    await loadProfiles();
    return res;
  },
  async update(id, data) {
    await rpc('update_staff', { p_id: id, p: data });
    await Promise.all([loadProfiles(), loadSettings()]);
    if (id === me()?.id) setSession(cache.byId.get(id), () => cache.settings);
  },
};

/* ---------------- to'lovlar ---------------- */
export const payments = {
  async list(f = {}) {
    const r = await rpc('payments_search', { f: cleanFilters(f), p_page: f.page || 1, p_size: Math.min(f.size || 50, 100000) });
    const rows = r.rows.map(decoratePayment);
    return { total: r.total, totals: r.totals, rows, all: rows };
  },
  async get(id) {
    const [p, h] = await Promise.all([
      sb.from('payments_v').select('*').eq('id', id).maybeSingle(),
      sb.from('payment_history').select('*').eq('payment_id', id).order('created_at', { ascending: false }),
    ]);
    const row = check(p);
    if (!row) throw new Error("To'lov topilmadi");
    return { ...decoratePayment(row), history: check(h).map(x => ({ ...x, user: profileName(x.user_id) })) };
  },
  async create(data) { return { id: await rpc('create_payment', { p: data }) }; },
  async receive(id, { amount, next_date, note }) {
    await rpc('receive_payment', { p_id: id, p_amount: Math.round(Number(amount)) || 0, p_next: next_date || null, p_note: note || '' });
  },
  async update(id, data) {
    const { reason, ...p } = data;
    await rpc('update_payment', { p_id: id, p, p_reason: reason || '' });
  },
  async cancel(id, reason) { await rpc('cancel_payment', { p_id: id, p_reason: reason }); },
};

/* ---------------- davomat ---------------- */
export const attendance = {
  async day(date) {
    const rows = check(await sb.from('attendance').select('profile_id,status,note').eq('date', date));
    const m = new Map(rows.map(r => [r.profile_id, r]));
    return cache.profiles.map(p => ({
      profile: { ...p }, status: m.get(p.id)?.status || '', note: m.get(p.id)?.note || '',
      in_rr: p.role === 'seller' && date === today() && isAtWork(p.id),
    }));
  },
  todayStatus(id) { return cache.att.get(id) || ''; },
  async set(profileId, date, status, note = '') {
    await rpc('set_attendance', { p_profile: profileId, p_date: date, p_status: status, p_note: note });
    if (date === today()) cache.att.set(profileId, status);
  },
  async month(ym) {
    const [y, m] = ym.split('-').map(Number);
    const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    const rows = await fetchAll(() => sb.from('attendance').select('profile_id,status').gte('date', `${ym}-01`).lt('date', end));
    return cache.profiles.map(p => {
      const c = { ishda: 0, kechikdi: 0, kelmadi: 0, ruxsat: 0, dam: 0 };
      for (const a of rows) if (a.profile_id === p.id) c[a.status]++;
      return { profile: { ...p }, ...c };
    });
  },
};

/* ---------------- hisobotlar va dashboard ---------------- */
const withRates = r => {
  const worked = r.leads - r.unanswered;
  return { ...r, worked, conversion: r.leads ? r.won / r.leads * 100 : 0 };
};

export const reports = {
  async sellers(f = {}) {
    const rows = await rpc('seller_report', { p_from: f.from || null, p_to: f.to || null });
    return rows.map(r => withRates({ ...r, seller: { ...(cache.byId.get(r.seller_id) || { full_name: '—' }) } }));
  },
};

export const dashboard = {
  async summary(f = {}) {
    await loadAttendance();
    const s = withRates(await rpc('dashboard_summary', { p_from: f.from || null, p_to: f.to || null }));
    s.calls = s.calls.map(decorateLead);
    s.fresh = s.fresh.map(decorateLead);
    s.debtors = s.debtors.map(decoratePayment);
    if (s.sellers) {
      s.sellers = s.sellers.map(x => withRates({ ...x, seller: { ...(cache.byId.get(x.seller_id) || { full_name: '—' }) } }));
      s.staffToday = cache.profiles.filter(p => p.active).map(p => ({ profile: { ...p }, att: cache.att.get(p.id) || '' }));
    }
    return s;
  },
};

/* ---------------- activity log ---------------- */
export const logs = {
  async list(f = {}) {
    const build = (count) => {
      let q = sb.from('activity_logs').select('*', count ? { count: 'exact' } : undefined).order('id', { ascending: false });
      if (f.user === 'system') q = q.is('user_id', null);
      else if (f.user) q = q.eq('user_id', f.user);
      if (f.action) q = f.action.includes('.') ? q.eq('action', f.action) : q.like('action', `${f.action}.%`);
      if (f.from) q = q.gte('created_at', dayStart(f.from));
      if (f.to) q = q.lt('created_at', nextDay(f.to));
      if (f.q?.trim()) q = q.ilike('label', `%${f.q.trim()}%`);
      return q;
    };
    const dec = r => ({ ...r, user: r.user_id ? profileName(r.user_id) : 'Tizim', action_name: ACTION_NAMES[r.action] || r.action });
    const size = f.size || 50, page = Math.max(1, f.page || 1);
    const { data, error, count } = await build(true).range((page - 1) * size, page * size - 1);
    if (error) throw new Error(friendly(error));
    return { total: count || 0, rows: data.map(dec), all: async () => (await fetchAll(() => build(false))).map(dec) };
  },
};

/* ---------------- telegram ---------------- */
export const telegram = {
  async createLink(leadId) {
    const token = await rpc('create_telegram_link', { p_lead: leadId, p_profile: null });
    return `https://t.me/${cache.settings.bot_username}?start=${token}`;
  },
  async notifications(f = {}) {
    let q = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(300);
    if (f.status) q = q.eq('status', f.status);
    if (f.audience) q = q.eq('audience', f.audience);
    return check(await q);
  },
};

/* ---------------- tashqi API (Instagram / Facebook reklama formalari) ---------------- */
async function invokeFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data;
}
export const integrations = {
  available: true,
  webhookUrl: `${SUPABASE_URL}/functions/v1/meta-leads`,
  metaStatus() { return rpc('integration_meta_status'); },
  async metaSave(p) { await rpc('integration_meta_save', { p }); },
  metaRetry() { return rpc('integration_meta_retry'); },
  metaTest() { return invokeFn('meta-leads', { action: 'test' }); },
  metaSync() { return invokeFn('meta-leads', { action: 'sync' }); },
};

/* ---------------- sozlamalar ---------------- */
export const settings = {
  get() { return JSON.parse(JSON.stringify(cache.settings)); },
  async save(patch) { await rpc('save_settings', { p: patch }); await loadSettings(); },
};

/* ---------------- to'liq zaxira ---------------- */
export async function backupTables() {
  const all = t => fetchAll(() => sb.from(t).select('*').order('created_at'));
  const [leadsT, paymentsT, history, notes, asg, att, logsT] = await Promise.all([
    all('leads'), all('payments'), all('payment_history'), all('lead_notes'), all('lead_assignments'),
    fetchAll(() => sb.from('attendance').select('*').order('date')), fetchAll(() => sb.from('activity_logs').select('*').order('id')),
  ]);
  return {
    profiles: cache.profiles, lead_statuses: cache.statuses, courses: cache.courses, settings: cache.settings,
    leads: leadsT, payments: paymentsT, payment_history: history, lead_notes: notes, lead_assignments: asg,
    attendance: att, activity_logs: logsT,
  };
}
