// Navbatdagi Telegram xabarlarini yuboradi. Supabase Cron har daqiqada chaqiradi (0004_cron.sql).
// 3 marta muvaffaqiyatsiz urinishdan keyin xabar "failed" bo'ladi, xato matni saqlanadi.
import { adminClient, json, safeEqual, sendTelegram } from '../_shared/util.ts';

const MAX_ATTEMPTS = 3;

Deno.serve(async req => {
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }
  const db = adminClient();
  const { data: queue, error } = await db.from('notifications')
    .select('id, chat_id, text, attempts')
    .eq('status', 'queued').lte('send_after', new Date().toISOString())
    .order('created_at').limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const n of queue ?? []) {
    try {
      if (!n.chat_id) throw new Error('Telegram botga ulanmagan');
      await sendTelegram(n.chat_id, n.text);
      await db.from('notifications').update({ status: 'sent', attempts: n.attempts + 1, sent_at: new Date().toISOString(), error: '' }).eq('id', n.id);
      sent++;
    } catch (e) {
      const attempts = n.attempts + 1;
      await db.from('notifications').update({
        attempts,
        error: String((e as Error).message).slice(0, 300),
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        // keyingi urinish: 1, 5 daqiqadan keyin
        send_after: new Date(Date.now() + (attempts === 1 ? 60e3 : 300e3)).toISOString(),
      }).eq('id', n.id);
      failed++;
    }
    await new Promise(r => setTimeout(r, 40)); // Telegram limiti: ~30 xabar/soniya
  }
  return json({ sent, failed });
});
