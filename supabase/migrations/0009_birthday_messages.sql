-- Tug'ilgan kun: bot mijozdan so'raydi, kuni kelganda mijozni bot orqali tabriklaydi,
-- sotuvchiga bir kun oldin va o'sha kuni eslatadi. CRM'dan mijozga bot orqali qo'lda xabar yuborish.

-- bot qaysi bosqichda (masalan tug'ilgan kunni kutmoqda)
alter table public.bot_state add column if not exists step text;

create or replace function public.daily_jobs() returns int
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
  -- mijozlar tug'ilgan kuni → mijozning o'ziga bot orqali tabrik
  for s in select * from public.leads where telegram_chat_id is not null and birthday is not null
             and extract(month from birthday) = extract(month from d) and extract(day from birthday) = extract(day from d) loop
    perform public.enqueue_notification('client', s.id, 'birthday.client',
      format('🎉 Hurmatli %s, tug''ilgan kuningiz bilan chin qalbdan tabriklaymiz! Sizga sog''lik, baxt va yo''llarda omad tilaymiz. — %s',
             s.first_name, coalesce(public.setting('center_name') #>> '{}', '')), 'cbday:' || s.id || ':' || d);
  end loop;
  -- ertaga tug'ilgan kuni bo'lgan mijozlar → mas'ul sotuvchiga oldindan eslatma
  for s in select * from public.leads where owner_id is not null and birthday is not null
             and extract(month from birthday) = extract(month from d + 1) and extract(day from birthday) = extract(day from d + 1) loop
    perform public.enqueue_notification('staff', s.owner_id, 'birthday.soon',
      format('Ertaga mijozingiz %s %s ning tug''ilgan kuni (%s). Tabriklashga tayyorlaning!', s.first_name, s.last_name, s.phone),
      'lbday1:' || s.id || ':' || d);
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

-- CRM'dan mijozga bot orqali xabar (sotuvchi faqat o'z leadiga). 1 daqiqa ichida yetkaziladi.
create or replace function public.send_lead_message(p_lead uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare v_chat bigint; v_name text;
begin
  perform public.require_role('admin', 'roop', 'seller');
  if not public.can_see_lead(p_lead) then raise exception 'Bu amal uchun sizda ruxsat yo''q' using errcode = '42501'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Xabar matnini yozing'; end if;
  select telegram_chat_id, trim(first_name || ' ' || last_name) into v_chat, v_name from public.leads where id = p_lead;
  if v_chat is null then raise exception 'Mijoz Telegram botga ulanmagan'; end if;
  perform public.enqueue_notification('client', p_lead, 'manual', left(trim(p_text), 3500));
  perform public.log_action('tg.message', 'lead', p_lead::text, v_name, null, to_jsonb(left(trim(p_text), 120)));
end $$;

grant execute on function public.send_lead_message(uuid, text) to authenticated;
