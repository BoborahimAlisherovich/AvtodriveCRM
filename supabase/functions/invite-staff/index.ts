// Yangi xodim qo'shish (faqat FULL ADMIN). Auth foydalanuvchi yaratiladi, profil esa
// handle_new_user triggeri orqali avtomatik qo'shiladi.
// Parol berilsa — darhol shu parol bilan kiradi; berilmasa — emailga taklif xati boradi.
import { adminClient, userClient, cors, json } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const caller = userClient(req);
    const { data: role, error: roleErr } = await caller.rpc('my_role');
    if (roleErr || role !== 'admin') return json({ error: "Faqat FULL ADMIN xodim qo'sha oladi" }, 403);

    const b = await req.json();
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!email || !b.full_name?.trim()) return json({ error: 'Ism va login (email) majburiy' }, 400);
    if (!['admin', 'roop', 'seller'].includes(b.role)) return json({ error: "Rol noto'g'ri" }, 400);

    const meta = {
      full_name: b.full_name.trim(), phone: b.phone ?? '', role: b.role, position: b.position ?? '',
      work_start: b.work_start ?? '09:00', work_end: b.work_end ?? '18:00', schedule: b.schedule ?? 'Du–Sha', birthday: b.birthday ?? '',
    };
    const admin = adminClient();
    const res = b.password
      ? await admin.auth.admin.createUser({ email, password: String(b.password), email_confirm: true, user_metadata: meta })
      : await admin.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo: b.redirect_to || undefined });
    if (res.error) return json({ error: res.error.message.includes('already') ? 'Bu login band' : res.error.message }, 400);

    // Trigger profilni nofaol sotuvchi qilib yaratadi; rol va faollikni shu yerda beramiz
    const id = res.data.user!.id;
    const { error: upErr } = await admin.from('profiles').update({ role: meta.role, active: true }).eq('id', id);
    if (upErr) return json({ error: upErr.message }, 500);
    await admin.from('activity_logs').insert({
      user_id: (await caller.auth.getUser()).data.user?.id, action: 'staff.create', entity: 'staff',
      entity_id: id, label: meta.full_name, new: meta.role,
    });
    return json({ id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
