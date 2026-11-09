-- Edge Functions (notify-dispatch, invite-staff) service_role bilan jadvallarga yozadi.
-- Loyiha "Automatically expose new tables" o'chirilgan holda yaratilsa, service_role
-- jadvallarga avtomatik huquq olmaydi — shuning uchun aniq beramiz.
-- service_role faqat serverda (Edge Functions) ishlatiladi, brauzerga hech qachon berilmaydi.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
