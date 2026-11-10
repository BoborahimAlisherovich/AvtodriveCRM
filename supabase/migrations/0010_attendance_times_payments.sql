-- Davomat: kelish va ketish vaqti (ishlagan soatlarni hisoblash uchun).
-- To'lov: mijozga qolgan qarz yoki to'liq to'langani haqida xabar.
-- Loyiha nomi: AvtodriveCRM.

alter table public.attendance add column if not exists time_in time;
alter table public.attendance add column if not exists time_out time;

-- Davomatni saqlash (faqat FULL ADMIN). Holat berilmasa, kelish vaqtidan aniqlanadi:
-- ish boshlanishidan 5 daqiqadan ko'p kech kelsa — "kechikdi", aks holda — "ishda".
create or replace function public.attendance_save(p_profile uuid, p_date date, p_status text, p_in text, p_out text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.profiles; o public.attendance; v_in time := nullif(trim(coalesce(p_in, '')), '')::time;
        v_out time := nullif(trim(coalesce(p_out, '')), '')::time; v_status public.att_status;
begin
  perform public.require_role('admin');
  select * into pr from public.profiles where id = p_profile;
  if not found then raise exception 'Xodim topilmadi'; end if;
  if v_in is not null and v_out is not null and v_out <= v_in then raise exception 'Ketish vaqti kelish vaqtidan keyin bo''lishi kerak'; end if;
  select * into o from public.attendance where profile_id = p_profile and date = p_date;
  v_status := coalesce(nullif(p_status, '')::public.att_status,
                       case when o.status in ('ishda', 'kechikdi') or o.status is null then
                         case when v_in is null then o.status
                              when v_in > (coalesce(nullif(pr.work_start, ''), '09:00')::time + interval '5 minutes') then 'kechikdi'::public.att_status
                              else 'ishda'::public.att_status end
                       else o.status end);
  if v_status is null then raise exception 'Holatni tanlang yoki kelish vaqtini kiriting'; end if;
  insert into public.attendance as a (profile_id, date, status, time_in, time_out, note, updated_by, updated_at)
  values (p_profile, p_date, v_status, v_in, v_out, coalesce(p_note, ''), auth.uid(), now())
  on conflict (profile_id, date) do update set status = excluded.status, time_in = excluded.time_in, time_out = excluded.time_out,
       note = coalesce(p_note, a.note), updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if o.status is distinct from v_status or o.time_in is distinct from v_in or o.time_out is distinct from v_out then
    perform public.log_action('att.set', 'attendance', p_profile::text, pr.full_name || ' — ' || to_char(p_date, 'DD.MM.YYYY'),
      jsonb_build_object('status', o.status, 'keldi', to_char(o.time_in, 'HH24:MI'), 'ketdi', to_char(o.time_out, 'HH24:MI')),
      jsonb_build_object('status', v_status, 'keldi', to_char(v_in, 'HH24:MI'), 'ketdi', to_char(v_out, 'HH24:MI')));
  end if;
end $$;
grant execute on function public.attendance_save(uuid, date, text, text, text, text) to authenticated;

-- Pul qabul qilish: mijozga qolgan qarz yoki "to'liq to'landi" xabari
create or replace function public.receive_payment(p_id uuid, p_amount bigint, p_next date default null, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare p public.payments; v_name text; v_left bigint;
begin
  perform public.require_role('admin', 'roop', 'seller');
  select * into p from public.payments where id = p_id for update;
  if not found then raise exception 'To''lov topilmadi'; end if;
  if not public.can_see_lead(p.lead_id) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if p.cancelled then raise exception 'Bekor qilingan to''lovga pul qabul qilib bo''lmaydi'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Summani kiriting'; end if;
  if p_amount > p.total - p.paid then raise exception 'Qolgan qarz % so''m. Undan ko''p kiritib bo''lmaydi', p.total - p.paid; end if;
  v_left := p.total - p.paid - p_amount;
  update public.payments set paid = paid + p_amount,
    next_date = case when v_left <= 0 then null else coalesce(p_next, next_date) end
  where id = p_id;
  insert into public.payment_history (payment_id, user_id, action, amount, note) values (p_id, auth.uid(), 'pay', p_amount, coalesce(p_note, ''));
  select trim(first_name || ' ' || last_name) into v_name from public.leads where id = p.lead_id;
  perform public.log_action('pay.receive', 'payment', p_id::text, v_name, null, to_jsonb(p_amount));
  perform public.enqueue_notification('client', p.lead_id, 'pay.received',
    case when v_left <= 0
      then format('To''lovingiz qabul qilindi: %s so''m. Kurs to''lovi to''liq yakunlandi ✅ Rahmat!', p_amount)
      else format('To''lovingiz qabul qilindi: %s so''m. Qolgan qarz: %s so''m%s. Rahmat!', p_amount, v_left,
                  coalesce(' (keyingi to''lov: ' || to_char(coalesce(p_next, p.next_date, p.due_date), 'DD.MM.YYYY') || ')', ''))
    end);
end $$;

update public.settings set value = '"AvtodriveCRM"' where key = 'center_name' and value = '"B va Express"';
