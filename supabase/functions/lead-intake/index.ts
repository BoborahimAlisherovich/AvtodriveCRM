// Tashqi manbalardan lead qabul qilish (Instagram reklama formasi, sayt, Telegram, Make/Zapier).
// POST { "first_name": "...", "last_name": "...", "phone": "...", "source": "Sayt", "comment": "..." }
// Sarlavha: x-api-key: <INTAKE_API_KEY>
// Lead Round Robin bo'yicha ishdagi sotuvchiga biriktiriladi. Raqam bazada bo'lsa — eski leadga izoh qo'shiladi.
import { adminClient, cors, json, safeEqual } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST kerak' }, 405);
  if (!safeEqual(req.headers.get('x-api-key') ?? '', Deno.env.get('INTAKE_API_KEY') ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "JSON noto'g'ri" }, 400);
  const { data, error } = await adminClient().rpc('intake_lead', {
    p: {
      first_name: String(b.first_name ?? b.name ?? '').slice(0, 100),
      last_name: String(b.last_name ?? '').slice(0, 100),
      phone: String(b.phone ?? ''),
      source: String(b.source ?? 'Sayt').slice(0, 60),
      comment: String(b.comment ?? '').slice(0, 1000),
    },
  });
  if (error) return json({ error: error.message }, 400);
  return json(data);
});
