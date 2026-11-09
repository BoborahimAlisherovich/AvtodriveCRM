-- Telegram bot menyusi: "Biz haqimizda", "Aloqa" matnlari (CRM sozlamalaridan tahrirlanadi)
-- va mijoz kursga yozilayotganda tanlagan toifani eslab qolish uchun holat jadvali.

insert into public.settings (key, value) values
  ('bot_about', to_jsonb('Biz — haydovchilik guvohnomasi (prava) olishga tayyorlovchi o''quv markazimiz. ' ||
                         'Nazariy darslar, avtodromda va shahar yo''llarida amaliy mashg''ulotlar, imtihonga tayyorlov.'::text)),
  ('bot_contacts', to_jsonb('Manzil va telefon raqami tez orada qo''shiladi.'::text))
on conflict (key) do nothing;

-- Bot holati: faqat Edge Function (service_role) ishlatadi, brauzerdan ko'rinmaydi
create table if not exists public.bot_state (
  chat_id bigint primary key,
  course_id uuid references public.courses (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.bot_state enable row level security;
revoke all on public.bot_state from anon, authenticated;
grant all on public.bot_state to service_role;

create or replace function public.save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; v_old jsonb := '{}'; v_new jsonb := '{}'; cur jsonb;
begin
  perform public.require_role('admin');
  for k, v in select * from jsonb_each(p) loop
    if k not in ('center_name', 'bot_username', 'sources', 'require_attendance', 'seller_can_transfer', 'remind_days_before', 'rr_order',
                 'bot_about', 'bot_contacts') then
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
