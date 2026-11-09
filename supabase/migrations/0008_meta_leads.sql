-- Instagram / Facebook reklama formalari (Meta Lead Ads) integratsiyasi.
-- Kalitlar (Page Access Token, App Secret) faqat serverda: brauzer ularni hech qachon to'liq ko'rmaydi.
-- Har bir Meta lead (leadgen_id) avval meta_lead_events ga yoziladi, keyin CRMga o'tkaziladi:
-- xato bo'lsa cron qayta urinadi, webhook o'tkazib yuborganlarini davriy sinxronlash topadi.

create table if not exists public.integrations (
  id text primary key,                       -- 'meta'
  config jsonb not null default '{}',        -- page_id, page_token, app_secret, verify_token, page_name, graph_version
  enabled boolean not null default false,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_lead_events (
  leadgen_id text primary key,
  form_id text,
  page_id text,
  ad_id text,
  platform text,
  via text not null default 'webhook',       -- webhook | sync
  payload jsonb,
  status text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  attempts int not null default 0,
  lead_id uuid references public.leads (id) on delete set null,
  duplicate boolean,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists meta_lead_events_status_idx on public.meta_lead_events (status, received_at);
create index if not exists meta_lead_events_received_idx on public.meta_lead_events (received_at desc);

alter table public.integrations enable row level security;
alter table public.meta_lead_events enable row level security;
revoke all on public.integrations, public.meta_lead_events from anon, authenticated;
grant all on public.integrations, public.meta_lead_events to service_role;

-- Admin kalitlarni saqlaydi. Bo'sh qoldirilgan maydon eski qiymatni o'zgartirmaydi.
create or replace function public.integration_meta_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; k text; v_enabled boolean;
begin
  perform public.require_role('admin');
  insert into public.integrations (id) values ('meta') on conflict (id) do nothing;
  select config into c from public.integrations where id = 'meta' for update;
  foreach k in array array['page_id', 'page_token', 'app_secret', 'graph_version'] loop
    if coalesce(trim(p ->> k), '') <> '' then c := c || jsonb_build_object(k, trim(p ->> k)); end if;
  end loop;
  if coalesce(c ->> 'verify_token', '') = '' then
    c := c || jsonb_build_object('verify_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  end if;
  v_enabled := coalesce((p ->> 'enabled')::boolean, false);
  if v_enabled and (coalesce(c ->> 'page_id', '') = '' or coalesce(c ->> 'page_token', '') = '' or coalesce(c ->> 'app_secret', '') = '') then
    raise exception 'Yoqish uchun Page ID, Page Access Token va App Secret kerak';
  end if;
  update public.integrations
     set config = c, enabled = v_enabled, updated_at = now(),
         connected_at = case when v_enabled then coalesce(connected_at, now()) else connected_at end
   where id = 'meta';
  perform public.log_action('settings.edit', 'settings', null, 'Instagram/Facebook API',
                            null, jsonb_build_object('enabled', v_enabled, 'page_id', c ->> 'page_id'));
end $$;

-- Admin uchun holat: kalitlar yashirilgan (faqat oxirgi 4 belgi)
create or replace function public.integration_meta_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.integrations; c jsonb;
begin
  perform public.require_role('admin');
  select * into i from public.integrations where id = 'meta';
  c := coalesce(i.config, '{}');
  return jsonb_build_object(
    'enabled', coalesce(i.enabled, false),
    'page_id', c ->> 'page_id',
    'page_name', c ->> 'page_name',
    'graph_version', coalesce(c ->> 'graph_version', 'v23.0'),
    'token_tail', case when coalesce(c ->> 'page_token', '') <> '' then right(c ->> 'page_token', 4) end,
    'has_app_secret', coalesce(c ->> 'app_secret', '') <> '',
    'verify_token', c ->> 'verify_token',
    'connected_at', i.connected_at, 'last_sync_at', i.last_sync_at, 'last_ok_at', i.last_ok_at, 'last_error', i.last_error,
    'stats', (select jsonb_build_object(
                'total', count(*),
                'done', count(*) filter (where status = 'done' and not coalesce(duplicate, false)),
                'duplicate', count(*) filter (where status = 'done' and duplicate),
                'queued', count(*) filter (where status = 'queued'),
                'failed', count(*) filter (where status = 'failed'),
                'today', count(*) filter (where received_at >= public.today_tz()::timestamp at time zone 'Asia/Tashkent'))
              from public.meta_lead_events),
    'recent', coalesce((select jsonb_agg(r order by r.received_at desc) from (
                select e.leadgen_id, e.status, e.duplicate, e.error, e.attempts, e.via, e.platform, e.received_at, e.lead_id,
                       trim(l.first_name || ' ' || l.last_name) as lead_name, l.phone
                  from public.meta_lead_events e left join public.leads l on l.id = e.lead_id
                 order by e.received_at desc limit 20) r), '[]'));
end $$;

-- Xato bo'lganlarini qayta navbatga qo'yish
create or replace function public.integration_meta_retry() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_role('admin');
  update public.meta_lead_events set status = 'queued', attempts = 0, error = null where status = 'failed';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.integration_meta_save(jsonb), public.integration_meta_status(), public.integration_meta_retry()
  to authenticated;
grant execute on function public.my_role() to service_role;
