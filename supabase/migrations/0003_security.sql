-- AvtodriveCRM — 3. Xavfsizlik: RLS siyosatlari va huquqlar.
-- Qoida: jadvallardan faqat O'QISH mumkin (rolga qarab). YOZISH faqat 0002 dagi
-- funksiyalar orqali — ular har safar rolni tekshiradi va Activity Logga yozadi.

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.lead_statuses enable row level security;
alter table public.courses enable row level security;
alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_history enable row level security;
alter table public.attendance enable row level security;
alter table public.activity_logs enable row level security;
alter table public.telegram_links enable row level security;
alter table public.notifications enable row level security;

-- Ma'lumotnomalar: tizimga kirgan har bir xodim ko'radi
create policy profiles_read on public.profiles for select to authenticated using (public.my_role() is not null);
create policy settings_read on public.settings for select to authenticated using (public.my_role() is not null);
create policy statuses_read on public.lead_statuses for select to authenticated using (public.my_role() is not null);
create policy courses_read on public.courses for select to authenticated using (public.my_role() is not null);

-- Leadlar: FULL ADMIN va ROOP — hammasi, sotuvchi — faqat o'ziga biriktirilganlar
create policy leads_read on public.leads for select to authenticated
  using (public.my_role() in ('admin', 'roop') or owner_id = auth.uid());
create policy lead_notes_read on public.lead_notes for select to authenticated
  using (public.can_see_lead(lead_id));
create policy lead_assignments_read on public.lead_assignments for select to authenticated
  using (public.can_see_lead(lead_id));

-- To'lovlar: sotuvchi faqat o'z mijozlarinikini ko'radi
create policy payments_read on public.payments for select to authenticated
  using (public.can_see_lead(lead_id));
create policy payment_history_read on public.payment_history for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and public.can_see_lead(p.lead_id)));

-- Davomat: FULL ADMIN va ROOP hammani, xodim faqat o'zini
create policy attendance_read on public.attendance for select to authenticated
  using (public.my_role() in ('admin', 'roop') or profile_id = auth.uid());

-- Activity Log: FULL ADMIN va ROOP hammasini, sotuvchi faqat o'z amallarini. Hech kim o'zgartira olmaydi.
create policy activity_logs_read on public.activity_logs for select to authenticated
  using (public.my_role() in ('admin', 'roop') or user_id = auth.uid());

create policy notifications_read on public.notifications for select to authenticated
  using (public.my_role() in ('admin', 'roop'));
-- telegram_links: siyosat yo'q = hech kim o'qiy olmaydi (faqat service role)

------------------------------------------------------------------ huquqlar
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.telegram_links from authenticated;

-- Funksiyalar: avval hammasini yopamiz, keyin faqat ilova chaqiradiganlarini ochamiz
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.my_role(), public.can_see_lead(uuid), public.tz_date(timestamptz), public.today_tz(),
  public.normalize_phone(text), public.pay_status_of(public.payments), public.setting(text),
  public.leads_filtered(jsonb), public.leads_search(jsonb, int, int), public.leads_kanban(jsonb, jsonb),
  public.badges(), public.find_lead_by_phone(text), public.my_transferred_leads(),
  public.create_lead(jsonb), public.update_lead(uuid, jsonb), public.set_lead_status(uuid, text),
  public.add_lead_note(uuid, text), public.transfer_leads(uuid[], uuid, text), public.delete_lead(uuid),
  public.import_leads(jsonb, text, uuid),
  public.payments_filtered(jsonb), public.payments_search(jsonb, int, int),
  public.create_payment(jsonb), public.receive_payment(uuid, bigint, date, text),
  public.update_payment(uuid, jsonb, text), public.cancel_payment(uuid, text),
  public.set_attendance(uuid, date, public.att_status, text),
  public.stage_create(text, text), public.stage_update(text, text, text), public.stage_move(text, int), public.stage_delete(text),
  public.course_save(jsonb), public.course_toggle(uuid), public.update_staff(uuid, jsonb), public.save_settings(jsonb),
  public.dashboard_summary(date, date), public.seller_report(date, date), public.create_telegram_link(uuid, uuid),
  public.is_at_work(uuid), public.require_role(text[])
to authenticated;

-- Faqat server (Edge Functions, Cron) uchun
grant execute on function public.intake_lead(jsonb), public.consume_telegram_token(text, bigint), public.daily_jobs()
to service_role;

-- Keyin yaratiladigan funksiyalar avtomatik ochiq bo'lib qolmasin
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
