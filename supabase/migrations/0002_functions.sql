-- AvtodriveCRM — 2. Biznes funksiyalari.
-- Barcha yozish amallari shu funksiyalar orqali bajariladi (security definer).
-- Har bir funksiya avval foydalanuvchi rolini tekshiradi, keyin Activity Logga yozadi.
-- Jadvallarga to'g'ridan-to'g'ri yozish RLS orqali yopilgan (0003).

------------------------------------------------------------------ ichki yordamchilar
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid() and active
$$;

create function public.require_role(variadic roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if r is null then raise exception 'Tizimga kiring' using errcode = '42501'; end if;
  if not (r = any (roles)) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  return r;
end $$;

create function public.can_see_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'roop'), false)
      or exists (select 1 from public.leads where id = p_lead and owner_id = auth.uid())
$$;

create function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key
$$;

create function public.log_action(p_action text, p_entity text, p_entity_id text, p_label text, p_old jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_logs (user_id, action, entity, entity_id, label, old, new)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_label, ''), p_old, p_new)
$$;

-- Telegram xabarini navbatga qo'yish (yuborishni notify-dispatch Edge Function bajaradi)
create function public.enqueue_notification(p_audience text, p_recipient uuid, p_kind text, p_text text, p_dedup text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_chat bigint; v_name text;
begin
  if p_audience = 'staff' then
    select telegram_chat_id, full_name into v_chat, v_name from public.profiles where id = p_recipient;
  else
    select telegram_chat_id, trim(first_name || ' ' || last_name) into v_chat, v_name from public.leads where id = p_recipient;
  end if;
  insert into public.notifications (audience, recipient_id, recipient, chat_id, kind, text, dedup_key, status, error)
  values (p_audience, p_recipient, coalesce(v_name, ''), v_chat, p_kind, p_text, p_dedup,
          case when v_chat is null then 'failed' else 'queued' end,
          case when v_chat is null then 'Telegram botga ulanmagan' else '' end)
  on conflict (dedup_key) do nothing;
end $$;

create function public.is_at_work(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_profile and active)
     and (
       not coalesce((public.setting('require_attendance') #>> '{}')::boolean, true)
       or exists (select 1 from public.attendance
                   where profile_id = p_profile and date = public.today_tz() and status in ('ishda', 'kechikdi'))
     )
$$;

-- Round Robin: navbatdagi ishda bo'lgan sotuvchi. Advisory lock bir vaqtda kelgan
-- leadlar bitta sotuvchiga ikki marta tushib qolishining oldini oladi.
create function public.pick_next_seller() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_order uuid[]; v_last uuid; n int; i int; v_start int; v_cand uuid;
begin
  perform pg_advisory_xact_lock(hashtext('bxcrm_round_robin'));
  select array(
    select t.x::uuid
      from jsonb_array_elements_text(coalesce(public.setting('rr_order'), '[]')) with ordinality t(x, o)
      join public.profiles p on p.id = t.x::uuid and p.role = 'seller'
     order by t.o) into v_order;
  n := coalesce(array_length(v_order, 1), 0);
  if n = 0 then return null; end if;
  v_last := nullif(public.setting('rr_last') #>> '{}', '')::uuid;
  v_start := coalesce(array_position(v_order, v_last), 0);
  for i in 1..n loop
    v_cand := v_order[((v_start + i - 1) % n) + 1];
    if public.is_at_work(v_cand) then
      insert into public.settings (key, value) values ('rr_last', to_jsonb(v_cand::text))
      on conflict (key) do update set value = excluded.value;
      return v_cand;
    end if;
  end loop;
  return null;
end $$;

create function public.try_timestamptz(p text) returns timestamptz
language plpgsql immutable as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end $$;

create function public.try_date(p text) returns date
language plpgsql immutable as $$
begin
  return nullif(p, '')::date;
exception when others then
  return null;
end $$;

------------------------------------------------------------------ yangi foydalanuvchi → profil
-- Supabase Auth'da foydalanuvchi yaratilganda profil avtomatik qo'shiladi.
-- Eng birinchi foydalanuvchi FULL ADMIN bo'ladi. Qolganlar NOFAOL sotuvchi bo'lib yaratiladi:
-- rol va faollikni faqat invite-staff (service role) beradi. user_metadata'ga ishonilmaydi,
-- chunki uni foydalanuvchi o'zi yozishi mumkin.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
        v_first boolean := not exists (select 1 from public.profiles where role = 'admin');
begin
  insert into public.profiles (id, email, full_name, phone, role, active, position, work_start, work_end, schedule, birthday)
  values (new.id, lower(new.email), coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          public.normalize_phone(m ->> 'phone'),
          case when v_first then 'admin' else 'seller' end::public.user_role, v_first,
          coalesce(m ->> 'position', ''),
          coalesce(nullif(m ->> 'work_start', ''), '09:00'), coalesce(nullif(m ->> 'work_end', ''), '18:00'),
          coalesce(nullif(m ->> 'schedule', ''), 'Du–Sha'), public.try_date(m ->> 'birthday'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Sotuvchilar navbat ro'yxatini (rr_order) avtomatik yangilash
create function public.sync_rr_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := coalesce(public.setting('rr_order'), '[]');
begin
  if new.role = 'seller' and new.active and not v ? new.id::text then
    v := v || to_jsonb(new.id::text);
  elsif new.role <> 'seller' then
    v := v - new.id::text;
  end if;
  insert into public.settings (key, value) values ('rr_order', v)
  on conflict (key) do update set value = excluded.value;
  return new;
end $$;

create trigger profiles_rr_order after insert or update of role, active on public.profiles
for each row execute function public.sync_rr_order();

------------------------------------------------------------------ leadlar: o'qish
-- Filtrlar: q, owner ('none' = biriktirilmagan), status, source, course, from, to, pay ('none' = to'lovsiz)
create function public.leads_filtered(f jsonb) returns setof public.leads_v
language sql stable as $$
  select l.* from public.leads_v l
   where (coalesce(f ->> 'q', '') = ''
          or l.search like '%' || replace(replace(replace(lower(f ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (coalesce(f ->> 'owner', '') = '' or (f ->> 'owner' = 'none' and l.owner_id is null) or l.owner_id::text = f ->> 'owner')
     and (coalesce(f ->> 'status', '') = '' or l.status_id = f ->> 'status')
     and (coalesce(f ->> 'source', '') = '' or l.source = f ->> 'source')
     and (coalesce(f ->> 'course', '') = '' or l.course_id::text = f ->> 'course')
     and (coalesce(f ->> 'from', '') = '' or l.created_at >= (f ->> 'from')::date::timestamp at time zone 'Asia/Tashkent')
     and (coalesce(f ->> 'to', '') = '' or l.created_at < ((f ->> 'to')::date + 1)::timestamp at time zone 'Asia/Tashkent')
     and (coalesce(f ->> 'pay', '') = '' or (f ->> 'pay' = 'none' and l.pay_status is null) or l.pay_status = f ->> 'pay')
$$;

create function public.leads_search(f jsonb default '{}', p_page int default 1, p_size int default 50) returns jsonb
language sql stable as $$
  with x as (select * from public.leads_filtered(f))
  select jsonb_build_object(
    'total', (select count(*) from x),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'search' order by r.created_at desc)
                        from (select * from x order by created_at desc
                               offset greatest(p_page - 1, 0) * p_size limit p_size) r), '[]'))
$$;

-- Kanban: har bir bosqich uchun jami soni va dastlabki N ta lead (bitta so'rovda)
create function public.leads_kanban(f jsonb default '{}', p_limits jsonb default '{}') returns jsonb
language sql stable as $$
  with x as (
    select l.*, count(*) over (partition by l.status_id) as total,
           row_number() over (partition by l.status_id order by l.created_at desc) as rn
      from public.leads_filtered(f - 'status') l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id,
           'total', coalesce((select max(total) from x where x.status_id = s.id), 0),
           'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'search' - 'total' - 'rn' order by x.created_at desc)
                               from x where x.status_id = s.id
                                and x.rn <= coalesce((p_limits ->> s.id)::int, 30)), '[]'))
         order by s.sort), '[]')
    from public.lead_statuses s
$$;

create function public.badges() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'fresh', (select count(*) from public.leads l join public.lead_statuses s on s.id = l.status_id where s.kind = 'new'),
    'debts', (select count(*) from public.payments_v where status = 'qarzdor'))
$$;

-- Takroriy raqamni tekshirish (sotuvchi boshqaning leadini ko'rmasa ham dublikat haqida biladi)
create function public.find_lead_by_phone(p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'name', trim(l.first_name || ' ' || l.last_name),
                            'owner', coalesce(p.full_name, '—'), 'visible', public.can_see_lead(l.id))
    from public.leads l left join public.profiles p on p.id = l.owner_id
   where public.my_role() is not null and l.phone = public.normalize_phone(p_phone)
$$;

-- Sotuvchi o'zi boshqaga yo'naltirgan leadlar (faqat holati ko'rinadi)
create function public.my_transferred_leads() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.at desc), '[]') from (
    select distinct on (a.lead_id) l.id, trim(l.first_name || ' ' || l.last_name) as name,
           a.to_id, l.owner_id, l.status_id, a.created_at as at, a.reason
      from public.lead_assignments a join public.leads l on l.id = a.lead_id
     where a.from_id = auth.uid() and a.by_id = auth.uid()
     order by a.lead_id, a.created_at desc) t
$$;

------------------------------------------------------------------ leadlar: yozish
create function public.insert_lead(p jsonb, p_owner uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_src text := coalesce(nullif(p ->> 'source', ''), 'Qo''lda kiritish');
begin
  insert into public.leads (first_name, last_name, phone, source, owner_id, status_id, course_id,
                            next_contact_at, comment, birthday, created_by, created_at)
  values (trim(p ->> 'first_name'), coalesce(trim(p ->> 'last_name'), ''), public.normalize_phone(p ->> 'phone'), v_src, p_owner,
          (select id from public.lead_statuses order by sort limit 1),
          nullif(p ->> 'course_id', '')::uuid, nullif(p ->> 'next_contact_at', '')::timestamptz,
          coalesce(p ->> 'comment', ''), nullif(p ->> 'birthday', '')::date, auth.uid(),
          coalesce(public.try_timestamptz(p ->> 'created_at'), now()))
  returning id, trim(first_name || ' ' || last_name) into v_id, v_name;
  insert into public.lead_assignments (lead_id, from_id, to_id, by_id, reason) values (v_id, null, p_owner, auth.uid(), p_reason);
  perform public.log_action('lead.create', 'lead', v_id::text, v_name, null, to_jsonb(v_src));
  if p_owner is not null and p_owner is distinct from auth.uid() then
    perform public.enqueue_notification('staff', p_owner, 'lead.assigned', 'Sizga yangi lead biriktirildi: ' || v_name);
  end if;
  return v_id;
end $$;

create function public.create_lead(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_role text := public.require_role('admin', 'roop', 'seller'); v_phone text := public.normalize_phone(p ->> 'phone');
        v_dup jsonb; v_owner uuid; v_reason text;
begin
  if coalesce(trim(p ->> 'first_name'), '') = '' then raise exception 'Ismni kiriting'; end if;
  if length(v_phone) < 13 then raise exception 'Telefon raqami to''liq emas (+998 XX XXX XX XX)'; end if;
  v_dup := public.find_lead_by_phone(v_phone);
  if v_dup is not null then
    raise exception 'Bu raqam bazada bor: % (mas''ul: %)', v_dup ->> 'name', v_dup ->> 'owner';
  end if;
  if v_role = 'seller' then
    v_owner := auth.uid(); v_reason := 'O''zi qo''shdi';
  elsif coalesce(p ->> 'owner_id', 'auto') not in ('', 'auto') then
    v_owner := (p ->> 'owner_id')::uuid; v_reason := 'Qo''lda biriktirildi';
    if not exists (select 1 from public.profiles where id = v_owner and active) then raise exception 'Tanlangan xodim faol emas'; end if;
  else
    v_owner := public.pick_next_seller(); v_reason := 'Avtomatik taqsimot (Round Robin)';
  end if;
  return public.insert_lead(p - 'created_at', v_owner, v_reason);
end $$;

-- Tashqi manbalardan (Instagram, sayt, Telegram) kelgan lead — faqat lead-intake Edge Function chaqiradi
create function public.intake_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.normalize_phone(p ->> 'phone'); v_id uuid;
begin
  if coalesce(trim(p ->> 'first_name'), '') = '' or length(v_phone) < 13 then
    raise exception 'first_name va phone majburiy';
  end if;
  select id into v_id from public.leads where phone = v_phone;
  if found then
    insert into public.lead_notes (lead_id, text) values (v_id, 'Qayta murojaat: ' || coalesce(p ->> 'source', '') || ' ' || coalesce(p ->> 'comment', ''));
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;
  v_id := public.insert_lead(p - 'created_at', public.pick_next_seller(), 'Avtomatik taqsimot (Round Robin)');
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

create function public.update_lead(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.leads; n public.leads; v_old jsonb; v_new jsonb; v_phone text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  select * into o from public.leads where id = p_id for update;
  if not found then raise exception 'Lead topilmadi'; end if;
  if not public.can_see_lead(p_id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if p ? 'first_name' and coalesce(trim(p ->> 'first_name'), '') = '' then raise exception 'Ism bo''sh bo''lmasin'; end if;
  if p ? 'phone' then
    v_phone := public.normalize_phone(p ->> 'phone');
    if length(v_phone) < 13 then raise exception 'Telefon raqami to''liq emas'; end if;
    if exists (select 1 from public.leads where phone = v_phone and id <> p_id) then raise exception 'Bu raqam boshqa leadda bor'; end if;
  end if;
  update public.leads set
    first_name = case when p ? 'first_name' then trim(p ->> 'first_name') else first_name end,
    last_name = case when p ? 'last_name' then coalesce(trim(p ->> 'last_name'), '') else last_name end,
    phone = case when p ? 'phone' then v_phone else phone end,
    source = case when p ? 'source' then coalesce(nullif(p ->> 'source', ''), source) else source end,
    course_id = case when p ? 'course_id' then nullif(p ->> 'course_id', '')::uuid else course_id end,
    next_contact_at = case when p ? 'next_contact_at' then nullif(p ->> 'next_contact_at', '')::timestamptz else next_contact_at end,
    comment = case when p ? 'comment' then coalesce(p ->> 'comment', '') else comment end,
    birthday = case when p ? 'birthday' then nullif(p ->> 'birthday', '')::date else birthday end
  where id = p_id returning * into n;
  select jsonb_object_agg(a.key, a.value), jsonb_object_agg(b.key, b.value) into v_old, v_new
    from jsonb_each(to_jsonb(o)) a join jsonb_each(to_jsonb(n)) b using (key)
   where a.value is distinct from b.value and a.key <> 'search';
  if v_new is not null then
    perform public.log_action('lead.edit', 'lead', p_id::text, trim(n.first_name || ' ' || n.last_name), v_old, v_new);
  end if;
end $$;

create function public.set_lead_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads; v_old text; v_new text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  select * into l from public.leads where id = p_id for update;
  if not found then raise exception 'Lead topilmadi'; end if;
  if not public.can_see_lead(p_id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  select name into v_new from public.lead_statuses where id = p_status;
  if v_new is null then raise exception 'Status topilmadi'; end if;
  if l.status_id = p_status then return; end if;
  select name into v_old from public.lead_statuses where id = l.status_id;
  update public.leads set status_id = p_status where id = p_id;
  perform public.log_action('lead.status', 'lead', p_id::text, trim(l.first_name || ' ' || l.last_name), to_jsonb(v_old), to_jsonb(v_new));
end $$;

create function public.add_lead_note(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  if not public.can_see_lead(p_id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Izoh matnini yozing'; end if;
  insert into public.lead_notes (lead_id, author_id, text) values (p_id, auth.uid(), trim(p_text));
  select trim(first_name || ' ' || last_name) into v_name from public.leads where id = p_id;
  perform public.log_action('lead.note', 'lead', p_id::text, v_name, null, to_jsonb(left(trim(p_text), 120)));
end $$;

create function public.transfer_leads(p_ids uuid[], p_to uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_role text := public.require_role('admin', 'roop', 'seller'); l public.leads; n int := 0; v_to_name text; v_me text;
begin
  if v_role = 'seller' then
    if not coalesce((public.setting('seller_can_transfer') #>> '{}')::boolean, false) then
      raise exception 'Sotuvchilarga lead yo''naltirish o''chirilgan' using errcode = '42501';
    end if;
    if coalesce(array_length(p_ids, 1), 0) > 1 then raise exception 'Ommaviy o''tkazish faqat ROOP va FULL ADMIN uchun' using errcode = '42501'; end if;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'O''tkazish sababini yozing'; end if;
  select full_name into v_to_name from public.profiles where id = p_to and active;
  if v_to_name is null then raise exception 'Nofaol xodimga lead o''tkazib bo''lmaydi'; end if;
  for l in select * from public.leads where id = any (p_ids) for update loop
    if not public.can_see_lead(l.id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
    continue when l.owner_id = p_to;
    update public.leads set owner_id = p_to where id = l.id;
    insert into public.lead_assignments (lead_id, from_id, to_id, by_id, reason) values (l.id, l.owner_id, p_to, auth.uid(), trim(p_reason));
    perform public.log_action(case when l.owner_id is null then 'lead.assign' else 'lead.transfer' end, 'lead', l.id::text,
                              trim(l.first_name || ' ' || l.last_name), to_jsonb(l.owner_id), to_jsonb(p_to));
    n := n + 1;
  end loop;
  if n > 0 then
    select full_name into v_me from public.profiles where id = auth.uid();
    perform public.enqueue_notification('staff', p_to, 'lead.transferred', format('Sizga %s ta lead o''tkazildi (%s): %s', n, v_me, trim(p_reason)));
  end if;
  return n;
end $$;

create function public.delete_lead(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  perform public.require_role('admin');
  if exists (select 1 from public.payments where lead_id = p_id) then raise exception 'Bu leadda to''lovlar bor. O''chirish mumkin emas'; end if;
  delete from public.leads where id = p_id returning trim(first_name || ' ' || last_name) into v_name;
  if v_name is null then raise exception 'Lead topilmadi'; end if;
  perform public.log_action('lead.delete', 'lead', p_id::text, v_name, null, null);
end $$;

-- Excel import. p_mode: auto | column | one | none
create function public.import_leads(p_rows jsonb, p_mode text default 'auto', p_owner uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_phone text; v_owner uuid; v_course uuid; added int := 0; dups int := 0; bad int := 0; v_key text;
begin
  perform public.require_role('admin', 'roop');
  for r in select * from jsonb_array_elements(p_rows) loop
    v_phone := public.normalize_phone(r ->> 'phone');
    if length(v_phone) < 12 or (coalesce(trim(r ->> 'first_name'), '') = '' and coalesce(trim(r ->> 'last_name'), '') = '') then
      bad := bad + 1; continue;
    end if;
    if exists (select 1 from public.leads where phone = v_phone) then dups := dups + 1; continue; end if;
    v_owner := case p_mode when 'one' then p_owner when 'auto' then public.pick_next_seller() else null end;
    if p_mode = 'column' and coalesce(trim(r ->> 'owner'), '') <> '' then
      v_key := lower(regexp_replace(trim(r ->> 'owner'), '[‘’''`ʻ]', '', 'g'));
      select id into v_owner from public.profiles
       where role = 'seller' and (lower(regexp_replace(full_name, '[‘’''`ʻ]', '', 'g')) like '%' || v_key || '%'
                                  or v_key like '%' || lower(regexp_replace(full_name, '[‘’''`ʻ]', '', 'g')) || '%')
       limit 1;
    end if;
    v_course := null;
    if coalesce(trim(r ->> 'course'), '') <> '' then
      select id into v_course from public.courses where name ilike '%' || trim(r ->> 'course') || '%' limit 1;
    end if;
    perform public.insert_lead(jsonb_build_object(
      'first_name', coalesce(nullif(trim(r ->> 'first_name'), ''), trim(r ->> 'last_name')),
      'last_name', case when coalesce(trim(r ->> 'first_name'), '') = '' then '' else coalesce(r ->> 'last_name', '') end,
      'phone', v_phone, 'source', coalesce(nullif(r ->> 'source', ''), 'Excel import'),
      'course_id', v_course, 'comment', coalesce(r ->> 'comment', ''), 'created_at', r ->> 'date'), v_owner, 'Excel import');
    added := added + 1;
  end loop;
  perform public.log_action('lead.import', 'lead', null, added || ' ta lead', null,
                            to_jsonb(format('qo''shildi: %s, takroriy: %s, xato: %s', added, dups, bad)));
  return jsonb_build_object('added', added, 'duplicates', dups, 'invalid', bad);
end $$;

------------------------------------------------------------------ to'lovlar
create function public.payments_filtered(f jsonb) returns setof public.payments_v
language sql stable as $$
  select p.* from public.payments_v p
   where (coalesce(f ->> 'q', '') = ''
          or lower(p.lead_name) like '%' || lower(f ->> 'q') || '%'
          or (length(regexp_replace(f ->> 'q', '\D', '', 'g')) >= 3 and p.phone like '%' || regexp_replace(f ->> 'q', '\D', '', 'g') || '%'))
     and (coalesce(f ->> 'status', '') = '' or p.status = f ->> 'status')
     and (coalesce(f ->> 'owner', '') = '' or p.owner_id::text = f ->> 'owner')
     and (coalesce(f ->> 'course', '') = '' or p.course_id::text = f ->> 'course')
     and (coalesce(f ->> 'from', '') = '' or public.tz_date(p.created_at) >= (f ->> 'from')::date)
     and (coalesce(f ->> 'to', '') = '' or public.tz_date(p.created_at) <= (f ->> 'to')::date)
$$;

create function public.payments_search(f jsonb default '{}', p_page int default 1, p_size int default 50) returns jsonb
language sql stable as $$
  with x as (select *, case status when 'qarzdor' then 0 when 'boshlangich' then 1 when 'tolangan' then 2 else 3 end as rank
               from public.payments_filtered(f)),
       a as (select * from x where status <> 'bekor')
  select jsonb_build_object(
    'total', (select count(*) from x),
    'totals', jsonb_build_object(
      'total', (select coalesce(sum(total), 0) from a),
      'paid', (select coalesce(sum(paid), 0) from a),
      'remaining', (select coalesce(sum(remaining), 0) from a),
      'debt', (select coalesce(sum(remaining), 0) from a where status = 'qarzdor'),
      'debtors', (select count(*) from a where status = 'qarzdor')),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'rank' order by r.rank, r.due)
                        from (select * from x order by rank, due offset greatest(p_page - 1, 0) * p_size limit p_size) r), '[]'))
$$;

create function public.create_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lead public.leads; v_total bigint := nullif(p ->> 'total', '')::bigint; v_paid bigint := coalesce(nullif(p ->> 'paid', '')::bigint, 0);
        v_id uuid; v_name text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  select * into v_lead from public.leads where id = (p ->> 'lead_id')::uuid;
  if not found then raise exception 'Mijozni tanlang'; end if;
  if not public.can_see_lead(v_lead.id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if coalesce(v_total, 0) <= 0 then raise exception 'Umumiy summani kiriting'; end if;
  if v_paid < 0 or v_paid > v_total then raise exception 'Boshlang''ich to''lov umumiy summadan oshmasin'; end if;
  if nullif(p ->> 'due_date', '') is null then raise exception 'To''lov muddatini belgilang'; end if;
  v_name := trim(v_lead.first_name || ' ' || v_lead.last_name);
  insert into public.payments (lead_id, course_id, total, paid, due_date, next_date, note, created_by)
  values (v_lead.id, coalesce(nullif(p ->> 'course_id', '')::uuid, v_lead.course_id), v_total, v_paid, (p ->> 'due_date')::date,
          case when v_paid < v_total then coalesce(nullif(p ->> 'next_date', '')::date, (p ->> 'due_date')::date) end,
          coalesce(p ->> 'note', ''), auth.uid())
  returning id into v_id;
  insert into public.payment_history (payment_id, user_id, action, amount, note) values (v_id, auth.uid(), 'create', v_total, coalesce(p ->> 'note', ''));
  if v_paid > 0 then
    insert into public.payment_history (payment_id, user_id, action, amount, note) values (v_id, auth.uid(), 'pay', v_paid, 'Boshlang''ich to''lov');
    perform public.enqueue_notification('client', v_lead.id, 'pay.received', format('To''lovingiz qabul qilindi: %s so''m. Rahmat!', v_paid));
  end if;
  perform public.log_action('pay.create', 'payment', v_id::text, v_name, null, to_jsonb(v_total));
  return v_id;
end $$;

-- Qo'shimcha to'lov qabul qilish: yangi yozuv qo'shiladi, summa/muddat o'zgarmaydi
create function public.receive_payment(p_id uuid, p_amount bigint, p_next date default null, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare p public.payments; v_name text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  select * into p from public.payments where id = p_id for update;
  if not found then raise exception 'To''lov topilmadi'; end if;
  if not public.can_see_lead(p.lead_id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if p.cancelled then raise exception 'Bekor qilingan to''lovga pul qabul qilib bo''lmaydi'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Summani kiriting'; end if;
  if p_amount > p.total - p.paid then raise exception 'Qolgan summa % so''m. Undan ko''p kiritib bo''lmaydi', p.total - p.paid; end if;
  update public.payments set paid = paid + p_amount,
    next_date = case when paid + p_amount >= total then null else coalesce(p_next, next_date) end
  where id = p_id;
  insert into public.payment_history (payment_id, user_id, action, amount, note) values (p_id, auth.uid(), 'pay', p_amount, coalesce(p_note, ''));
  select trim(first_name || ' ' || last_name) into v_name from public.leads where id = p.lead_id;
  perform public.log_action('pay.receive', 'payment', p_id::text, v_name, null, to_jsonb(p_amount));
  perform public.enqueue_notification('client', p.lead_id, 'pay.received', format('To''lovingiz qabul qilindi: %s so''m. Rahmat!', p_amount));
end $$;

-- Summa, muddat, kursni o'zgartirish — faqat FULL ADMIN
create function public.update_payment(p_id uuid, p jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.payments; n public.payments; v_old jsonb; v_new jsonb;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_reason), '') = '' then raise exception 'O''zgartirish sababini yozing'; end if;
  select * into o from public.payments where id = p_id for update;
  if not found then raise exception 'To''lov topilmadi'; end if;
  if o.cancelled then raise exception 'Bekor qilingan to''lovni tahrirlab bo''lmaydi'; end if;
  if p ? 'total' and coalesce(nullif(p ->> 'total', '')::bigint, 0) <= 0 then raise exception 'Umumiy summa noto''g''ri'; end if;
  if coalesce(nullif(p ->> 'paid', '')::bigint, o.paid) > coalesce(nullif(p ->> 'total', '')::bigint, o.total)
     or coalesce(nullif(p ->> 'paid', '')::bigint, o.paid) < 0 then
    raise exception 'To''langan summa umumiy summadan oshmasin';
  end if;
  update public.payments set
    total = case when p ? 'total' then (p ->> 'total')::bigint else total end,
    paid = case when p ? 'paid' then coalesce(nullif(p ->> 'paid', '')::bigint, 0) else paid end,
    due_date = case when p ? 'due_date' then coalesce(nullif(p ->> 'due_date', '')::date, due_date) else due_date end,
    next_date = case when p ? 'next_date' then nullif(p ->> 'next_date', '')::date else next_date end,
    note = case when p ? 'note' then coalesce(p ->> 'note', '') else note end,
    course_id = case when p ? 'course_id' then nullif(p ->> 'course_id', '')::uuid else course_id end
  where id = p_id returning * into n;
  select jsonb_object_agg(a.key, a.value), jsonb_object_agg(b.key, b.value) into v_old, v_new
    from jsonb_each(to_jsonb(o)) a join jsonb_each(to_jsonb(n)) b using (key)
   where a.value is distinct from b.value;
  if v_new is null then return; end if;
  insert into public.payment_history (payment_id, user_id, action, old, new, note) values (p_id, auth.uid(), 'edit', v_old, v_new, trim(p_reason));
  perform public.log_action('pay.edit', 'payment', p_id::text,
                            (select trim(first_name || ' ' || last_name) from public.leads where id = o.lead_id), v_old, v_new);
end $$;

create function public.cancel_payment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bekor qilish sababini yozing'; end if;
  update public.payments set cancelled = true, cancel_reason = trim(p_reason) where id = p_id and not cancelled returning lead_id into v_lead;
  if v_lead is null then raise exception 'To''lov topilmadi yoki allaqachon bekor qilingan'; end if;
  insert into public.payment_history (payment_id, user_id, action, note) values (p_id, auth.uid(), 'cancel', trim(p_reason));
  perform public.log_action('pay.cancel', 'payment', p_id::text,
                            (select trim(first_name || ' ' || last_name) from public.leads where id = v_lead), null, to_jsonb(trim(p_reason)));
end $$;

------------------------------------------------------------------ davomat
create function public.set_attendance(p_profile uuid, p_date date, p_status public.att_status, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.att_status; v_name text;
begin
  perform public.require_role('admin');
  select full_name into v_name from public.profiles where id = p_profile;
  if v_name is null then raise exception 'Xodim topilmadi'; end if;
  select status into v_old from public.attendance where profile_id = p_profile and date = p_date;
  insert into public.attendance (profile_id, date, status, note, updated_by, updated_at)
  values (p_profile, p_date, p_status, coalesce(p_note, ''), auth.uid(), now())
  on conflict (profile_id, date) do update set status = excluded.status, note = excluded.note,
                                               updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if v_old is distinct from p_status then
    perform public.log_action('att.set', 'attendance', p_profile::text, v_name || ' — ' || to_char(p_date, 'DD.MM.YYYY'),
                              to_jsonb(v_old), to_jsonb(p_status));
  end if;
end $$;

------------------------------------------------------------------ Kanban bosqichlari
create function public.stage_create(p_name text, p_color text) returns text
language plpgsql security definer set search_path = public as $$
declare v_sort int; v_id text;
begin
  perform public.require_role('admin', 'roop');
  if coalesce(trim(p_name), '') = '' then raise exception 'Bosqich nomini kiriting'; end if;
  select coalesce((select sort from public.lead_statuses where kind = 'won'), (select max(sort) + 1 from public.lead_statuses)) into v_sort;
  update public.lead_statuses set sort = sort + 1 where sort >= v_sort;
  insert into public.lead_statuses (name, color, sort) values (trim(p_name), coalesce(nullif(p_color, ''), '#2fc6f6'), v_sort) returning id into v_id;
  perform public.log_action('stage.create', 'stage', v_id, trim(p_name), null, null);
  return v_id;
end $$;

create function public.stage_update(p_id text, p_name text, p_color text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  perform public.require_role('admin', 'roop');
  select name into v_old from public.lead_statuses where id = p_id;
  if v_old is null then raise exception 'Bosqich topilmadi'; end if;
  update public.lead_statuses set name = coalesce(nullif(trim(p_name), ''), name), color = coalesce(nullif(p_color, ''), color) where id = p_id;
  perform public.log_action('stage.edit', 'stage', p_id, coalesce(nullif(trim(p_name), ''), v_old), to_jsonb(v_old), to_jsonb(coalesce(nullif(trim(p_name), ''), v_old)));
end $$;

create function public.stage_move(p_id text, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare a public.lead_statuses; b public.lead_statuses;
begin
  perform public.require_role('admin', 'roop');
  select * into a from public.lead_statuses where id = p_id;
  if p_dir < 0 then
    select * into b from public.lead_statuses where sort < a.sort order by sort desc limit 1;
  else
    select * into b from public.lead_statuses where sort > a.sort order by sort limit 1;
  end if;
  if b.id is null then return; end if;
  update public.lead_statuses set sort = b.sort where id = a.id;
  update public.lead_statuses set sort = a.sort where id = b.id;
end $$;

create function public.stage_delete(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.lead_statuses; n int;
begin
  perform public.require_role('admin', 'roop');
  select * into s from public.lead_statuses where id = p_id;
  if s.id is null then raise exception 'Bosqich topilmadi'; end if;
  if s.is_system then raise exception 'Tizim bosqichini o''chirib bo''lmaydi'; end if;
  select count(*) into n from public.leads where status_id = p_id;
  if n > 0 then raise exception 'Bu bosqichda % ta lead bor. Avval ularni boshqa bosqichga o''tkazing', n; end if;
  delete from public.lead_statuses where id = p_id;
  perform public.log_action('stage.delete', 'stage', p_id, s.name, null, null);
end $$;

------------------------------------------------------------------ kurslar
create function public.course_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public.require_role('admin');
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Kurs nomini kiriting'; end if;
  if v_id is null then
    insert into public.courses (name, description, price, duration, schedule, topics, teacher)
    values (trim(p ->> 'name'), coalesce(p ->> 'description', ''), coalesce(nullif(p ->> 'price', '')::bigint, 0),
            coalesce(p ->> 'duration', ''), coalesce(p ->> 'schedule', ''), coalesce(p ->> 'topics', ''), coalesce(p ->> 'teacher', ''))
    returning id into v_id;
    perform public.log_action('course.create', 'course', v_id::text, trim(p ->> 'name'), null, null);
  else
    update public.courses set name = trim(p ->> 'name'), description = coalesce(p ->> 'description', ''),
      price = coalesce(nullif(p ->> 'price', '')::bigint, 0), duration = coalesce(p ->> 'duration', ''),
      schedule = coalesce(p ->> 'schedule', ''), topics = coalesce(p ->> 'topics', ''), teacher = coalesce(p ->> 'teacher', '')
    where id = v_id;
    if not found then raise exception 'Kurs topilmadi'; end if;
    perform public.log_action('course.edit', 'course', v_id::text, trim(p ->> 'name'), null, null);
  end if;
  return v_id;
end $$;

create function public.course_toggle(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.courses;
begin
  perform public.require_role('admin');
  update public.courses set active = not active where id = p_id returning * into c;
  if c.id is null then raise exception 'Kurs topilmadi'; end if;
  perform public.log_action('course.edit', 'course', p_id::text, c.name,
                            to_jsonb(case when c.active then 'Nofaol' else 'Faol' end), to_jsonb(case when c.active then 'Faol' else 'Nofaol' end));
end $$;

------------------------------------------------------------------ xodimlar
-- Yangi xodim invite-staff Edge Function orqali qo'shiladi (Auth foydalanuvchisi kerak).
create function public.update_staff(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.profiles; n public.profiles; v_old jsonb; v_new jsonb;
begin
  perform public.require_role('admin');
  select * into o from public.profiles where id = p_id for update;
  if not found then raise exception 'Xodim topilmadi'; end if;
  if p_id = auth.uid() and ((p ? 'role' and p ->> 'role' <> 'admin') or (p ? 'active' and not (p ->> 'active')::boolean)) then
    raise exception 'O''zingizning rolingizni yoki faolligingizni o''zgartira olmaysiz';
  end if;
  if p ? 'full_name' and coalesce(trim(p ->> 'full_name'), '') = '' then raise exception 'Ism familiyani kiriting'; end if;
  update public.profiles set
    full_name = case when p ? 'full_name' then trim(p ->> 'full_name') else full_name end,
    phone = case when p ? 'phone' then public.normalize_phone(p ->> 'phone') else phone end,
    role = case when p ? 'role' then (p ->> 'role')::public.user_role else role end,
    position = case when p ? 'position' then coalesce(p ->> 'position', '') else position end,
    work_start = case when p ? 'work_start' then coalesce(nullif(p ->> 'work_start', ''), work_start) else work_start end,
    work_end = case when p ? 'work_end' then coalesce(nullif(p ->> 'work_end', ''), work_end) else work_end end,
    schedule = case when p ? 'schedule' then coalesce(p ->> 'schedule', '') else schedule end,
    birthday = case when p ? 'birthday' then nullif(p ->> 'birthday', '')::date else birthday end,
    active = case when p ? 'active' then (p ->> 'active')::boolean else active end
  where id = p_id returning * into n;
  select jsonb_object_agg(a.key, a.value), jsonb_object_agg(b.key, b.value) into v_old, v_new
    from jsonb_each(to_jsonb(o)) a join jsonb_each(to_jsonb(n)) b using (key)
   where a.value is distinct from b.value;
  if v_new is not null then perform public.log_action('staff.edit', 'staff', p_id::text, n.full_name, v_old, v_new); end if;
end $$;

------------------------------------------------------------------ sozlamalar
create function public.save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; v_old jsonb := '{}'; v_new jsonb := '{}'; cur jsonb;
begin
  perform public.require_role('admin');
  for k, v in select * from jsonb_each(p) loop
    if k not in ('center_name', 'bot_username', 'sources', 'require_attendance', 'seller_can_transfer', 'remind_days_before', 'rr_order') then
      raise exception 'Noma''lum sozlama: %', k;
    end if;
    cur := public.setting(k);
    if cur is distinct from v then
      v_old := v_old || jsonb_build_object(k, cur);
      v_new := v_new || jsonb_build_object(k, v);
      insert into public.settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value;
    end if;
  end loop;
  if v_new <> '{}' then
    perform public.log_action('settings.edit', 'settings', null, (select string_agg(x, ', ') from jsonb_object_keys(v_new) x), v_old, v_new);
  end if;
end $$;

------------------------------------------------------------------ dashboard va hisobotlar
-- security invoker: sotuvchi uchun RLS avtomatik faqat o'z ma'lumotlarini qoldiradi
create function public.dashboard_summary(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable as $$
declare v_role text := public.require_role('admin', 'roop', 'seller'); v_today date := public.today_tz();
        v_end timestamptz := (public.today_tz() + 1)::timestamp at time zone 'Asia/Tashkent'; r jsonb;
begin
  with sl as (select l.*, s.kind from public.leads l join public.lead_statuses s on s.id = l.status_id),
       pl as (select * from sl where (p_from is null or public.tz_date(created_at) >= p_from) and (p_to is null or public.tz_date(created_at) <= p_to)),
       rev as (select l.owner_id, sum(h.amount) as amt
                 from public.payment_history h
                 join public.payments p on p.id = h.payment_id and not p.cancelled
                 join public.leads l on l.id = p.lead_id
                where h.action = 'pay' and (p_from is null or public.tz_date(h.created_at) >= p_from)
                  and (p_to is null or public.tz_date(h.created_at) <= p_to)
                group by l.owner_id),
       pays as (select * from public.payments_v where status <> 'bekor'),
       calls as (select l.* from public.leads_v l join public.lead_statuses s on s.id = l.status_id
                  where l.next_contact_at < v_end and (s.kind is null or s.kind not in ('won', 'lost')))
  select jsonb_build_object(
    'leads', (select count(*) from pl),
    'won', (select count(*) from pl where kind = 'won'),
    'lost', (select count(*) from pl where kind = 'lost'),
    'unanswered', (select count(*) from pl where kind in ('new', 'noanswer')),
    'totalLeads', (select count(*) from sl),
    'todayLeads', (select count(*) from sl where public.tz_date(created_at) = v_today),
    'revenue', (select coalesce(sum(amt), 0) from rev),
    'expected', (select coalesce(sum(remaining), 0) from pays where status = 'boshlangich'),
    'debt', (select coalesce(sum(remaining), 0) from pays where status = 'qarzdor'),
    'callsTotal', (select count(*) from calls),
    'calls', coalesce((select jsonb_agg(to_jsonb(c) - 'search' order by c.next_contact_at)
                         from (select * from calls order by next_contact_at limit 10) c), '[]'),
    'fresh', coalesce((select jsonb_agg(to_jsonb(f) - 'search' order by f.created_at desc)
                         from (select l.* from public.leads_v l join public.lead_statuses s on s.id = l.status_id
                                where s.kind = 'new' order by l.created_at desc limit 8) f), '[]'),
    'debtors', coalesce((select jsonb_agg(to_jsonb(d) order by d.remaining desc)
                           from (select * from pays where status = 'qarzdor' order by remaining desc limit 6) d), '[]'),
    'sellers', case when v_role <> 'seller' then coalesce((
       select jsonb_agg(jsonb_build_object(
                'seller_id', s.id,
                'leads', (select count(*) from pl where owner_id = s.id),
                'won', (select count(*) from pl where owner_id = s.id and kind = 'won'),
                'lost', (select count(*) from pl where owner_id = s.id and kind = 'lost'),
                'unanswered', (select count(*) from pl where owner_id = s.id and kind in ('new', 'noanswer')),
                'revenue', coalesce((select amt from rev where owner_id = s.id), 0),
                'att', (select status from public.attendance where profile_id = s.id and date = v_today),
                'in_rr', public.is_at_work(s.id)) order by s.full_name)
         from public.profiles s where s.role = 'seller' and (s.active or exists (select 1 from public.leads x where x.owner_id = s.id))), '[]') end
  ) into r;
  return r;
end $$;

create function public.seller_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable as $$
declare r jsonb;
begin
  perform public.require_role('admin', 'roop');
  with pl as (select l.*, s.kind from public.leads l join public.lead_statuses s on s.id = l.status_id
               where (p_from is null or public.tz_date(l.created_at) >= p_from) and (p_to is null or public.tz_date(l.created_at) <= p_to)),
       asg as (select * from public.lead_assignments
                where (p_from is null or public.tz_date(created_at) >= p_from) and (p_to is null or public.tz_date(created_at) <= p_to)),
       rev as (select l.owner_id, sum(h.amount) as amt
                 from public.payment_history h
                 join public.payments p on p.id = h.payment_id and not p.cancelled
                 join public.leads l on l.id = p.lead_id
                where h.action = 'pay' and (p_from is null or public.tz_date(h.created_at) >= p_from)
                  and (p_to is null or public.tz_date(h.created_at) <= p_to)
                group by l.owner_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'seller_id', s.id,
           'received', (select count(*) from asg where to_id = s.id),
           'leads', (select count(*) from pl where owner_id = s.id),
           'won', (select count(*) from pl where owner_id = s.id and kind = 'won'),
           'lost', (select count(*) from pl where owner_id = s.id and kind = 'lost'),
           'unanswered', (select count(*) from pl where owner_id = s.id and kind in ('new', 'noanswer')),
           'sentOut', (select count(*) from asg where from_id = s.id and to_id is not null),
           'receivedIn', (select count(*) from asg where to_id = s.id and from_id is not null),
           'revenue', coalesce((select amt from rev where owner_id = s.id), 0)) order by s.full_name), '[]')
    into r
    from public.profiles s where s.role = 'seller' and (s.active or exists (select 1 from public.leads x where x.owner_id = s.id));
  return r;
end $$;

------------------------------------------------------------------ telegram
-- Bir martalik token: 64 belgi, bazada faqat sha256 hash, 24 soat amal qiladi
create function public.create_telegram_link(p_lead uuid default null, p_profile uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); v_name text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  if p_lead is not null then
    if not public.can_see_lead(p_lead) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
    select trim(first_name || ' ' || last_name) into v_name from public.leads where id = p_lead;
  else
    if p_profile <> auth.uid() then perform public.require_role('admin'); end if;
    select full_name into v_name from public.profiles where id = coalesce(p_profile, auth.uid());
    p_profile := coalesce(p_profile, auth.uid());
  end if;
  insert into public.telegram_links (lead_id, profile_id, token_hash, expires_at, created_by)
  values (p_lead, p_profile, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '24 hours', auth.uid());
  perform public.log_action('tg.link', case when p_lead is null then 'staff' else 'lead' end, coalesce(p_lead, p_profile)::text, v_name, null, null);
  return v_token;
end $$;

-- Faqat telegram-webhook (service role) chaqiradi. Tekshirish va ishlatilgan deb belgilash atomar.
create function public.consume_telegram_token(p_hash text, p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.telegram_links; v_name text;
begin
  update public.telegram_links set used_at = now(), chat_id = p_chat
   where token_hash = p_hash and used_at is null and expires_at > now()
  returning * into t;
  if t.id is null then return null; end if;
  if t.lead_id is not null then
    update public.leads set telegram_chat_id = p_chat where id = t.lead_id returning trim(first_name || ' ' || last_name) into v_name;
  else
    update public.profiles set telegram_chat_id = p_chat where id = t.profile_id returning full_name into v_name;
  end if;
  update public.notifications set chat_id = p_chat
   where recipient_id = coalesce(t.lead_id, t.profile_id) and chat_id is null and status = 'queued';
  return jsonb_build_object('kind', case when t.lead_id is null then 'staff' else 'client' end, 'name', v_name);
end $$;

-- Har kuni (Cron) ishga tushadi: eslatmalar va hisobotlarni navbatga qo'yadi
create function public.daily_jobs() returns int
language plpgsql security definer set search_path = public as $$
declare d date := public.today_tz(); v_days int := coalesce((public.setting('remind_days_before') #>> '{}')::int, 3);
        p record; s record; n int := 0; v_txt text;
begin
  -- to'lov muddati yaqinlashgan mijozlar
  for p in select * from public.payments_v where status = 'boshlangich' and due = d + v_days loop
    perform public.enqueue_notification('client', p.lead_id, 'pay.reminder',
      format('Eslatma: %s gacha %s so''m to''lov qilishingiz kerak.', to_char(p.due, 'DD.MM.YYYY'), p.remaining), 'due:' || p.id || ':' || p.due);
    n := n + 1;
  end loop;
  -- qarzdorlar: 1, 3, 7-kun va keyin har hafta
  for p in select * from public.payments_v where status = 'qarzdor' and ((d - due) in (1, 3) or (d - due) % 7 = 0) loop
    perform public.enqueue_notification('client', p.lead_id, 'pay.debt',
      format('To''lov muddati %s da tugagan. Qarzdorlik: %s so''m.', to_char(p.due, 'DD.MM.YYYY'), p.remaining), 'debt:' || p.id || ':' || d);
    n := n + 1;
  end loop;
  -- xodimlar tug'ilgan kuni → barcha faol xodimlarga
  for s in select * from public.profiles where active and birthday is not null
             and extract(month from birthday) = extract(month from d) and extract(day from birthday) = extract(day from d) loop
    insert into public.notifications (audience, recipient_id, recipient, chat_id, kind, text, dedup_key)
    select 'staff', x.id, x.full_name, x.telegram_chat_id, 'birthday', format('Bugun %s ning tug''ilgan kuni! 🎉', s.full_name), 'bday:' || s.id || ':' || x.id || ':' || d
      from public.profiles x where x.active and x.telegram_chat_id is not null and x.id <> s.id
    on conflict (dedup_key) do nothing;
  end loop;
  -- mijozlar tug'ilgan kuni → mas'ul sotuvchiga
  for s in select * from public.leads where owner_id is not null and birthday is not null
             and extract(month from birthday) = extract(month from d) and extract(day from birthday) = extract(day from d) loop
    perform public.enqueue_notification('staff', s.owner_id, 'birthday',
      format('Bugun mijozingiz %s %s ning tug''ilgan kuni. Tabriklashni unutmang!', s.first_name, s.last_name), 'lbday:' || s.id || ':' || d);
  end loop;
  -- kechagi natijalar: FULL ADMIN va ROOPga umumiy, sotuvchilarga shaxsiy
  v_txt := format('Kechagi natija (%s): yangi leadlar %s ta, sotuvlar %s ta, tushum %s so''m. Umumiy qarzdorlik: %s so''m.',
    to_char(d - 1, 'DD.MM.YYYY'),
    (select count(*) from public.leads where public.tz_date(created_at) = d - 1),
    (select count(*) from public.activity_logs a where a.action = 'lead.status' and a.new = to_jsonb((select name from public.lead_statuses where kind = 'won')) and public.tz_date(a.created_at) = d - 1),
    (select coalesce(sum(amount), 0) from public.payment_history where action = 'pay' and public.tz_date(created_at) = d - 1),
    (select coalesce(sum(remaining), 0) from public.payments_v where status = 'qarzdor'));
  for s in select * from public.profiles where active and role in ('admin', 'roop') loop
    perform public.enqueue_notification('staff', s.id, 'report.daily', v_txt, 'report:' || s.id || ':' || d);
  end loop;
  for s in select * from public.profiles where active and role = 'seller' loop
    perform public.enqueue_notification('staff', s.id, 'report.seller',
      format('Kechagi natijangiz: yangi leadlar %s ta, izohlar %s ta, qabul qilingan to''lovlar %s so''m.',
        (select count(*) from public.lead_assignments where to_id = s.id and public.tz_date(created_at) = d - 1),
        (select count(*) from public.lead_notes where author_id = s.id and public.tz_date(created_at) = d - 1),
        (select coalesce(sum(amount), 0) from public.payment_history where user_id = s.id and action = 'pay' and public.tz_date(created_at) = d - 1)),
      'sreport:' || s.id || ':' || d);
  end loop;
  return n;
end $$;
