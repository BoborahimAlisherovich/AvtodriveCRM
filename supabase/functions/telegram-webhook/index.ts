// Telegram Webhook: mijoz yoki xodim /start TOKEN bosganda chat_id ni CRMga bog'laydi.
// Telegram so'rovni X-Telegram-Bot-Api-Secret-Token sarlavhasi bilan yuboradi (setWebhook secret_token).
import { adminClient, safeEqual, sha256Hex, sendTelegram } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('ok');
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text: string = msg?.text ?? '';
  if (!chatId) return new Response('ok');

  try {
    const m = text.match(/^\/start\s+([A-Za-z0-9_-]{16,64})$/);
    if (m) {
      const { data, error } = await adminClient().rpc('consume_telegram_token', {
        p_hash: await sha256Hex(m[1]),
        p_chat: chatId,
      });
      if (error) throw error;
      if (data) {
        await sendTelegram(chatId, data.kind === 'client'
          ? `Assalomu alaykum, ${data.name}! Siz B va Express botiga muvaffaqiyatli ulandingiz. To'lov va dars eslatmalarini shu yerda olasiz.`
          : `${data.name}, siz CRM xabarnomalariga ulandingiz.`);
      } else {
        await sendTelegram(chatId, "Havola yaroqsiz yoki muddati tugagan. Iltimos, menejeringizdan yangi havola so'rang.");
      }
    } else if (text.startsWith('/start')) {
      await sendTelegram(chatId, "Assalomu alaykum! Botga ulanish uchun menejeringiz yuborgan maxsus havolani oching.");
    }
  } catch (e) {
    console.error('telegram-webhook', e);
  }
  // Telegram qayta yubormasligi uchun har doim 200
  return new Response('ok');
});
