-- AvtodriveCRM — 1. Jadvallar, indekslar, ko'rinishlar (views)
-- Supabase SQL Editor'da tartib bilan ishga tushiring: 0001 → 0002 → 0003 → 0004.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.user_role as enum ('admin', 'roop', 'seller');
create type public.att_status as enum ('ishda', 'kechikdi', 'kelmadi', 'ruxsat', 'dam');
create type public.stage_kind as enum ('new', 'noanswer', 'won', 'lost');

-- Toshkent vaqti bo'yicha sana
create function public.tz_date(t timestamptz) returns date
language sql immutable as $$ select (t at time zone 'Asia/Tashkent')::date $$;

create function public.today_tz() returns date
language sql stable as $$ select (now() at time zone 'Asia/Tashkent')::date $$;

-- Telefonni yagona formatga keltirish: +998XXXXXXXXX
create function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 9 then d := '998' || d; end if;
  if length(d) = 10 and left(d, 1) = '8' then d := '998' || substr(d, 2); end if;
  if d = '' then return ''; end if;
  return '+' || d;
end $$;

------------------------------------------------------------------ xodimlar
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null default '',
  email text not null unique,
  role public.user_role not null default 'seller',
  position text not null default '',
  work_start text not null default '09:00',
  work_end text not null default '18:00',
  schedule text not null default 'Du–Sha',
  birthday date,
  active boolean not null default true,
  telegram_chat_id bigint,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------ sozlamalar
create table public.settings (
  key text primary key,
  value jsonb not null
);

------------------------------------------------------------------ lead statuslari (Kanban bosqichlari)
create table public.lead_statuses (
  id text primary key default gen_random_uuid()::text,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#2fc6f6',
  kind public.stage_kind unique,          -- tizim bosqichlari (statistika uchun)
  sort int not null default 0,
  is_system boolean not null default false
);

------------------------------------------------------------------ kurslar
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  price bigint not null default 0 check (price >= 0),
  duration text not null default '',
  schedule text not null default '',
  topics text not null default '',
  teacher text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------ leadlar
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null default '',
  phone text not null unique check (phone ~ '^\+\d{11,15}$'),
  source text not null default 'Qo''lda kiritish',
  owner_id uuid references public.profiles (id),
  status_id text not null references public.lead_statuses (id),
  course_id uuid references public.courses (id),
  next_contact_at timestamptz,
  comment text not null default '',
  birthday date,
  telegram_chat_id bigint,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- qidiruv uchun: "ism familiya familiya ism +998..."
  search text generated always as (
    lower(first_name || ' ' || last_name || ' ' || last_name || ' ' || first_name) || ' ' || phone
  ) stored
);
create index leads_owner_idx on public.leads (owner_id, created_at desc);
create index leads_status_idx on public.leads (status_id, created_at desc);
create index leads_created_idx on public.leads (created_at desc);
create index leads_next_contact_idx on public.leads (next_contact_at) where next_contact_at is not null;
create index leads_search_idx on public.leads using gin (search extensions.gin_trgm_ops);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  author_id uuid references public.profiles (id),
  text text not null check (length(trim(text)) > 0),
  created_at timestamptz not null default now()
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

-- Lead biriktirish va o'tkazish tarixi
create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_id uuid references public.profiles (id),
  to_id uuid references public.profiles (id),
  by_id uuid references public.profiles (id),      -- null = tizim (avtomatik)
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index lead_assignments_lead_idx on public.lead_assignments (lead_id, created_at desc);
create index lead_assignments_to_idx on public.lead_assignments (to_id, created_at);
create index lead_assignments_from_idx on public.lead_assignments (from_id, created_at);

------------------------------------------------------------------ to'lovlar
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  course_id uuid references public.courses (id),
  total bigint not null check (total > 0),
  paid bigint not null default 0,
  due_date date not null,
  next_date date,
  note text not null default '',
  cancelled boolean not null default false,
  cancel_reason text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (paid >= 0 and paid <= total)
);
create index payments_lead_idx on public.payments (lead_id);

create table public.payment_history (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  user_id uuid references public.profiles (id),
  action text not null check (action in ('create', 'pay', 'edit', 'cancel')),
  amount bigint,
  old jsonb,
  new jsonb,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index payment_history_payment_idx on public.payment_history (payment_id, created_at desc);
create index payment_history_pay_idx on public.payment_history (created_at) where action = 'pay';

------------------------------------------------------------------ davomat
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  status public.att_status not null,
  note text not null default '',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (profile_id, date)
);
create index attendance_date_idx on public.attendance (date);

------------------------------------------------------------------ activity log
create table public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id text,
  label text not null default '',
  old jsonb,
  new jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_user_idx on public.activity_logs (user_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity, entity_id);

------------------------------------------------------------------ telegram
create table public.telegram_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  token_hash text not null unique,       -- tokenning o'zi saqlanmaydi, faqat sha256
  expires_at timestamptz not null,
  used_at timestamptz,
  chat_id bigint,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((lead_id is null) <> (profile_id is null))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'telegram',
  audience text not null check (audience in ('staff', 'client')),
  recipient_id uuid,
  recipient text not null default '',
  chat_id bigint,
  kind text not null,
  text text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  error text not null default '',
  dedup_key text unique,                 -- bir xil eslatma ikki marta ketmasligi uchun
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_queue_idx on public.notifications (send_after) where status = 'queued';
create index notifications_created_idx on public.notifications (created_at desc);

------------------------------------------------------------------ hisoblangan maydonlar
create function public.pay_status_of(p public.payments) returns text
language sql stable as $$
  select case
    when p.cancelled then 'bekor'
    when p.total - p.paid <= 0 then 'tolangan'
    when coalesce(p.next_date, p.due_date) < public.today_tz() then 'qarzdor'
    else 'boshlangich'
  end
$$;

-- security_invoker: ko'rinish so'rovchining RLS huquqlari bilan ishlaydi
create view public.payments_v with (security_invoker = true) as
select p.*,
  trim(l.first_name || ' ' || l.last_name) as lead_name,
  l.phone,
  l.owner_id,
  greatest(p.total - p.paid, 0) as remaining,
  public.pay_status_of(p) as status,
  coalesce(p.next_date, p.due_date) as due
from public.payments p
join public.leads l on l.id = p.lead_id;

create view public.leads_v with (security_invoker = true) as
select l.*,
  (select case
            when bool_or(public.pay_status_of(p) = 'qarzdor') then 'qarzdor'
            when bool_or(public.pay_status_of(p) = 'boshlangich') then 'boshlangich'
            when count(*) > 0 then 'tolangan'
          end
     from public.payments p
    where p.lead_id = l.id and not p.cancelled) as pay_status
from public.leads l;

------------------------------------------------------------------ boshlang'ich ma'lumotlar
insert into public.lead_statuses (id, name, color, kind, sort, is_system) values
  ('st_new', 'Yangi Lead', '#2fc6f6', 'new', 1, true),
  ('st_contacted', 'Aloqa qilindi', '#39b5d6', null, 2, false),
  ('st_noanswer', 'Javob bermadi', '#ff7a76', 'noanswer', 3, true),
  ('st_callback', 'Qayta qo''ng''iroq', '#ffa900', null, 4, false),
  ('st_interest', 'Qiziqmoqda', '#a77bde', null, 5, false),
  ('st_trial', 'Sinov darsiga yozildi', '#5b8def', null, 6, false),
  ('st_attended', 'Darsga keldi', '#3cc3a6', null, 7, false),
  ('st_waitpay', 'To''lov kutilmoqda', '#e8b400', null, 8, false),
  ('st_won', 'Sotuv amalga oshdi', '#7bd500', 'won', 9, true),
  ('st_lost', 'Bekor qilindi', '#9aa3ab', 'lost', 10, true);

insert into public.settings (key, value) values
  ('center_name', '"AvtodriveCRM"'),
  ('bot_username', '"Avtodrive_roobot"'),
  ('sources', '["Instagram reklama","Telegram","Sayt","Telefon","Qo''lda kiritish","Excel import","Tavsiya"]'),
  ('rr_order', '[]'),
  ('rr_last', 'null'),
  ('require_attendance', 'true'),
  ('seller_can_transfer', 'true'),
  ('remind_days_before', '3');
