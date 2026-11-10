-- AvtodriveCRM — 4. Avtomatlashtirish (Supabase Cron).
-- Ishga tushirishdan oldin:
--   1) Database → Extensions bo'limida pg_cron va pg_net ni yoqing.
--   2) Pastdagi <PROJECT_REF> va <CRON_SECRET> ni o'zingiznikiga almashtiring
--      (CRON_SECRET — Edge Function secrets'dagi bilan bir xil bo'lsin).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Har kuni 09:00 (Toshkent) — to'lov eslatmalari, qarzdorlik, tug'ilgan kunlar, kunlik hisobot
select cron.schedule('bxcrm-daily-jobs', '0 4 * * *', $$ select public.daily_jobs() $$);

-- Har daqiqada — navbatdagi Telegram xabarlarini yuborish
select cron.schedule('bxcrm-notify-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
$$);

-- Har daqiqada — Instagram/Facebook reklama leadlari: navbatni qayta ishlash va har 10 daqiqada Meta bilan sinxronlash
select cron.schedule('bxcrm-meta-leads', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/meta-leads',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
$$);
