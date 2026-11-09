// Instagram / Facebook reklama formalari (Meta Lead Ads) → CRM leadlari.
//
// So'rov turlari:
//   GET  ?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..  — Meta webhook tasdiqlash
//   POST + X-Hub-Signature-256                                       — Meta webhook (yangi lead)
//   POST + x-cron-secret                                             — har daqiqada: navbatni qayta ishlash + davriy sinxronlash
//   POST + Authorization (FULL ADMIN) { action: 'test' | 'sync' }    — CRM "API" sahifasidan
//
// Ishonchlilik: har bir lead (leadgen_id) avval meta_lead_events ga yoziladi (takrorlanmaydi),
// keyin CRMga o'tkaziladi. Xato bo'lsa — cron qayta urinadi. Webhook kelmay qolgan leadlarni
// har 10 daqiqadagi sinxronlash Meta'dan o'zi olib keladi.
import { adminClient, userClient, cors, json, safeEqual } from '../_shared/util.ts';

const MAX_ATTEMPTS = 8;
const SYNC_EVERY_MS = 10 * 60 * 1000;
const LEAD_FIELDS = 'id,created_time,field_data,form_id,ad_id,ad_name,adset_name,campaign_name,platform,is_organic';

type Cfg = { page_id?: string; page_token?: string; app_secret?: string; verify_token?: string; page_name?: string; graph_version?: string };
type Integration = { config: Cfg; enabled: boolean; connected_at: string | null; last_sync_at: string | null };

const db = () => adminClient();

async function loadIntegration(): Promise<Integration | null> {
  const { data } = await db().from('integrations').select('config,enabled,connected_at,last_sync_at').eq('id', 'meta').maybeSingle();
  return data as Integration | null;
}

async function patchIntegration(p: Record<string, unknown>) {
  await db().from('integrations').update({ ...p, updated_at: new Date().toISOString() }).eq('id', 'meta');
}

async function graph(cfg: Cfg, path: string, params: Record<string, string> = {}, method = 'GET') {
  const v = cfg.graph_version || 'v23.0';
  const url = new URL(`https://graph.facebook.com/${v}/${path.replace(/^\//, '')}`);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  url.searchParams.set('access_token', cfg.page_token ?? '');
  const res = await fetch(url, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new Error(`Meta API: ${e.message || res.status}${e.code ? ` (kod ${e.code})` : ''}`);
  }
  return data;
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- lead → CRM ---------------- */
function fieldsOf(lead: any) {
  const f: Record<string, string> = {};
  for (const x of lead?.field_data ?? []) f[String(x.name).toLowerCase()] = (x.values ?? []).join(', ');
  return f;
}

function toCrm(lead: any) {
  const f = fieldsOf(lead);
  const pick = (...keys: string[]) => keys.map(k => f[k]).find(v => v && v.trim()) ?? '';
  let first = pick('first_name', 'ism'), last = pick('last_name', 'familiya');
  const full = pick('full_name', 'name', 'ism_familiya', 'fio');
  if (!first && full) { const parts = full.trim().split(/\s+/); first = parts.shift() ?? ''; last = last || parts.join(' '); }
  const phone = pick('phone_number', 'phone', 'telefon', 'telefon_raqam', 'raqam');
  const used = new Set(['first_name', 'ism', 'last_name', 'familiya', 'full_name', 'name', 'ism_familiya', 'fio', 'phone_number', 'phone', 'telefon', 'telefon_raqam', 'raqam']);
  const answers = Object.entries(f).filter(([k, v]) => !used.has(k) && v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
  const meta = [lead.campaign_name && `Kampaniya: ${lead.campaign_name}`, lead.ad_name && `Reklama: ${lead.ad_name}`].filter(Boolean);
  const platform = String(lead.platform ?? '').toLowerCase();
  return {
    first_name: (first || 'Instagram mijoz').slice(0, 100),
    last_name: last.slice(0, 100),
    phone,
    source: platform === 'fb' ? 'Facebook reklama' : 'Instagram reklama',
    comment: ['Reklama formasi orqali ariza', ...answers, ...meta].join('\n').slice(0, 1000),
  };
}

async function processEvent(cfg: Cfg, ev: any) {
  const id = ev.leadgen_id;
  try {
    const lead = ev.payload?.field_data ? ev.payload : await graph(cfg, id, { fields: LEAD_FIELDS });
    const p = toCrm(lead);
    if (!p.phone) {
      await db().from('meta_lead_events').update({
        status: 'failed', attempts: MAX_ATTEMPTS, payload: lead, platform: lead.platform ?? null,
        error: "Formada telefon raqami yo'q — reklama formasiga «Telefon raqam» maydonini qo'shing",
        processed_at: new Date().toISOString(),
      }).eq('leadgen_id', id);
      return false;
    }
    const { data, error } = await db().rpc('intake_lead', { p });
    if (error) throw new Error(error.message);
    await db().from('meta_lead_events').update({
      status: 'done', lead_id: data?.id ?? null, duplicate: !!data?.duplicate, error: null, payload: null,
      platform: lead.platform ?? null, form_id: lead.form_id ?? ev.form_id ?? null, ad_id: lead.ad_id ?? ev.ad_id ?? null,
      attempts: (ev.attempts ?? 0) + 1, processed_at: new Date().toISOString(),
    }).eq('leadgen_id', id);
    return true;
  } catch (e) {
    const attempts = (ev.attempts ?? 0) + 1;
    await db().from('meta_lead_events').update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', attempts, error: String((e as Error).message ?? e).slice(0, 500),
    }).eq('leadgen_id', id);
    return false;
  }
}

// Navbat: bir vaqtda 6 tadan, 45 soniya ichida imkon qadar ko'p (keyingisi — keyingi daqiqada)
async function processQueue(cfg: Cfg, onlyIds?: string[]) {
  const until = Date.now() + 45_000;
  let ok = 0, fail = 0;
  while (Date.now() < until) {
    let q = db().from('meta_lead_events').select('*').eq('status', 'queued').lt('attempts', MAX_ATTEMPTS).order('received_at').limit(60);
    if (onlyIds?.length) q = q.in('leadgen_id', onlyIds);
    const { data } = await q;
    if (!data?.length) break;
    for (let i = 0; i < data.length && Date.now() < until; i += 6) {
      const res = await Promise.all(data.slice(i, i + 6).map(ev => processEvent(cfg, ev)));
      for (const r of res) r ? ok++ : fail++;
    }
    if (onlyIds?.length || data.length < 60) break;
  }
  return { ok, fail };
}

/* ---------------- davriy sinxronlash (webhook o'tkazib yuborganlarini topadi) ---------------- */
async function syncFromMeta(integ: Integration) {
  const cfg = integ.config;
  const base = integ.last_sync_at ?? integ.connected_at ?? new Date().toISOString();
  // 1 soat ustma-ust (birinchi marta — 1 kun orqaga): hech narsa tirqishdan tushib qolmasin
  const back = integ.last_sync_at ? 3600e3 : 86400e3;
  const since = Math.floor((new Date(base).getTime() - back) / 1000);
  const startedAt = new Date().toISOString();
  let found = 0;
  let after = '';
  do {
    const forms = await graph(cfg, `${cfg.page_id}/leadgen_forms`, { fields: 'id,name,status', limit: '100', ...(after ? { after } : {}) });
    for (const form of forms.data ?? []) {
      let lafter = '';
      do {
        const leads = await graph(cfg, `${form.id}/leads`, {
          fields: LEAD_FIELDS, limit: '100',
          filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]),
          ...(lafter ? { after: lafter } : {}),
        });
        const rows = (leads.data ?? []).map((l: any) => ({
          leadgen_id: String(l.id), form_id: form.id, page_id: cfg.page_id, ad_id: l.ad_id ?? null,
          platform: l.platform ?? null, via: 'sync', payload: l,
        }));
        if (rows.length) {
          const { data: ins } = await db().from('meta_lead_events')
            .upsert(rows, { onConflict: 'leadgen_id', ignoreDuplicates: true }).select('leadgen_id');
          found += ins?.length ?? 0;
        }
        lafter = leads.paging?.next ? leads.paging?.cursors?.after ?? '' : '';
      } while (lafter);
    }
    after = forms.paging?.next ? forms.paging?.cursors?.after ?? '' : '';
  } while (after);
  await patchIntegration({ last_sync_at: startedAt, last_ok_at: startedAt, last_error: null });
  return found;
}

async function runCycle(force = false) {
  const integ = await loadIntegration();
  if (!integ?.enabled || !integ.config?.page_token) return { skipped: true };
  const out: Record<string, unknown> = {};
  const due = force || !integ.last_sync_at || Date.now() - new Date(integ.last_sync_at).getTime() > SYNC_EVERY_MS;
  if (due) {
    try { out.synced = await syncFromMeta(integ); } catch (e) {
      out.sync_error = (e as Error).message;
      await patchIntegration({ last_error: `Sinxronlash: ${(e as Error).message}`.slice(0, 500) });
    }
  }
  out.queue = await processQueue(integ.config);
  return out;
}

/* ---------------- admin: ulanishni tekshirish ---------------- */
async function testConnection() {
  const integ = await loadIntegration();
  const cfg = integ?.config ?? {};
  if (!cfg.page_id || !cfg.page_token) return { ok: false, error: 'Avval Page ID va Page Access Token ni saqlang' };
  const warnings: string[] = [];
  try {
    const page = await graph(cfg, 'me', { fields: 'id,name' });
    if (String(page.id) !== String(cfg.page_id)) {
      warnings.push(`Token boshqa sahifaga tegishli (${page.name}, ID ${page.id}). Page ID ni tekshiring.`);
    }
    let subscribed = false;
    try {
      const r = await graph(cfg, `${cfg.page_id}/subscribed_apps`, { subscribed_fields: 'leadgen' }, 'POST');
      subscribed = !!r.success;
    } catch (e) { warnings.push(`Sahifani webhook'ga obuna qilib bo'lmadi: ${(e as Error).message}`); }
    const forms = await graph(cfg, `${cfg.page_id}/leadgen_forms`, { fields: 'id,name,status', limit: '100' });
    const newCfg = { ...cfg, page_name: page.name };
    await db().from('integrations').update({ config: newCfg, last_error: warnings[0] ?? null, last_ok_at: new Date().toISOString() }).eq('id', 'meta');
    return { ok: true, page_name: page.name, subscribed, forms: (forms.data ?? []).map((f: any) => ({ name: f.name, status: f.status })), warnings };
  } catch (e) {
    await patchIntegration({ last_error: (e as Error).message.slice(0, 500) });
    return { ok: false, error: (e as Error).message };
  }
}

/* ---------------- kirish nuqtasi ---------------- */
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);

  // Meta webhook'ni tasdiqlash
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') !== 'subscribe') return new Response('ok');
    const integ = await loadIntegration();
    const ok = safeEqual(url.searchParams.get('hub.verify_token') ?? '', integ?.config?.verify_token ?? '');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  const raw = await req.text();

  // Cron: har daqiqada
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== null) {
    if (!safeEqual(cronSecret, Deno.env.get('CRON_SECRET') ?? '')) return json({ error: 'forbidden' }, 403);
    return json(await runCycle());
  }

  // Meta webhook
  const sig = req.headers.get('x-hub-signature-256');
  if (sig !== null) {
    const integ = await loadIntegration();
    const secret = integ?.config?.app_secret ?? '';
    if (!secret || !safeEqual(sig, 'sha256=' + await hmacHex(secret, raw))) return new Response('forbidden', { status: 403 });
    const body = JSON.parse(raw || '{}');
    const rows: any[] = [];
    for (const entry of body.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        if (ch.field !== 'leadgen' || !ch.value?.leadgen_id) continue;
        rows.push({
          leadgen_id: String(ch.value.leadgen_id), form_id: ch.value.form_id ?? null,
          page_id: String(ch.value.page_id ?? entry.id ?? ''), ad_id: ch.value.ad_id ?? null, via: 'webhook',
        });
      }
    }
    if (rows.length) {
      // 1) Darhol saqlaymiz — shu lahzadan lead yo'qolmaydi
      await db().from('meta_lead_events').upsert(rows, { onConflict: 'leadgen_id', ignoreDuplicates: true });
      // 2) Darhol CRMga o'tkazamiz (xato bo'lsa cron qayta urinadi)
      if (integ?.enabled) await processQueue(integ.config, rows.map(r => r.leadgen_id)).catch(e => console.error('meta-leads', e));
    }
    return new Response('EVENT_RECEIVED');
  }

  // CRM admin
  const { data: role } = await userClient(req).rpc('my_role');
  if (role !== 'admin') return json({ error: 'Faqat FULL ADMIN uchun' }, 403);
  const b = JSON.parse(raw || '{}');
  if (b.action === 'test') return json(await testConnection());
  if (b.action === 'sync') return json(await runCycle(true));
  return json({ error: "Noma'lum amal" }, 400);
});
