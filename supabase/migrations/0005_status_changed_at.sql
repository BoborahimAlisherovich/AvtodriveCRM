-- Kanban: lead bosqichga o'tkazilgan vaqt. Oxirgi o'tkazilgan lead ustun boshida turadi.
-- Boshqa sotuvchiga o'tkazilgan lead: kimdan, qachon, sabab va "Sizga o'tkazilgan" belgisi.
alter table public.leads add column if not exists status_changed_at timestamptz;
update public.leads set status_changed_at = created_at where status_changed_at is null;
alter table public.leads alter column status_changed_at set default now();
create index if not exists leads_status_moved_idx on public.leads (status_id, status_changed_at desc);

alter table public.leads add column if not exists transferred_from uuid references public.profiles (id);
alter table public.leads add column if not exists transferred_at timestamptz;
alter table public.leads add column if not exists transfer_reason text;
-- true — yangi egasi leadni hali harakatga keltirmagan (bosqichini o'zgartirmagan)
alter table public.leads add column if not exists transfer_new boolean not null default false;

-- leads_v "l.*" bilan yaratilgan — yangi ustunlarni oxiriga qo'shib qayta yaratamiz
-- (create or replace view faqat oxiriga ustun qo'shishga ruxsat beradi)
create or replace view public.leads_v with (security_invoker = true) as
select l.id, l.first_name, l.last_name, l.phone, l.source, l.owner_id, l.status_id, l.course_id,
  l.next_contact_at, l.comment, l.birthday, l.telegram_chat_id, l.created_by, l.created_at, l.search,
  (select case
            when bool_or(public.pay_status_of(p) = 'qarzdor') then 'qarzdor'
            when bool_or(public.pay_status_of(p) = 'boshlangich') then 'boshlangich'
            when count(*) > 0 then 'tolangan'
          end
     from public.payments p
    where p.lead_id = l.id and not p.cancelled) as pay_status,
  l.status_changed_at, l.transferred_from, l.transferred_at, l.transfer_reason, l.transfer_new
from public.leads l;

create or replace function public.leads_kanban(f jsonb default '{}', p_limits jsonb default '{}') returns jsonb
language sql stable as $$
  with x as (
    select l.*, count(*) over (partition by l.status_id) as total,
           row_number() over (partition by l.status_id
                              order by greatest(coalesce(l.status_changed_at, l.created_at), l.transferred_at) desc) as rn
      from public.leads_filtered(f - 'status') l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id,
           'total', coalesce((select max(total) from x where x.status_id = s.id), 0),
           'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'search' - 'total' - 'rn' order by x.rn)
                               from x where x.status_id = s.id
                                and x.rn <= coalesce((p_limits ->> s.id)::int, 30)), '[]'))
         order by s.sort), '[]')
    from public.lead_statuses s
$$;

create or replace function public.set_lead_status(p_id uuid, p_status text) returns void
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
  update public.leads
     set status_id = p_status, status_changed_at = now(),
         -- yangi egasi leadni harakatga keltirdi — "Sizga o'tkazilgan" belgisi olinadi
         transfer_new = case when owner_id = auth.uid() then false else transfer_new end
   where id = p_id;
  perform public.log_action('lead.status', 'lead', p_id::text, trim(l.first_name || ' ' || l.last_name), to_jsonb(v_old), to_jsonb(v_new));
end $$;

create or replace function public.transfer_leads(p_ids uuid[], p_to uuid, p_reason text) returns int
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
    if l.owner_id is null then
      update public.leads set owner_id = p_to where id = l.id;
    else
      update public.leads
         set owner_id = p_to, transferred_from = l.owner_id, transferred_at = now(),
             transfer_reason = trim(p_reason), transfer_new = true
       where id = l.id;
    end if;
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
