// Telegram Webhook.
// 1) /start TOKEN — mijoz yoki xodim chat_id sini CRMga bog'laydi (menejer yuborgan havola).
// 2) Oddiy foydalanuvchilar uchun menyu: Kurslar, Biz haqimizda, Kursga yozilish, Aloqa.
//    Kursga yozilgan mijoz telefon raqamini yuboradi — CRMga lead bo'lib tushadi (manba: Telegram).
// Telegram so'rovni X-Telegram-Bot-Api-Secret-Token sarlavhasi bilan yuboradi (setWebhook secret_token).
import { adminClient, safeEqual, sha256Hex } from '../_shared/util.ts';

const BTN = {
  courses: '🚗 Kurslar',
  about: 'ℹ️ Biz haqimizda',
  enroll: '📝 Kursga yozilish',
  contacts: '📞 Aloqa',
  back: '⬅️ Menyu',
};

const MENU = {
  keyboard: [[{ text: BTN.courses }, { text: BTN.about }], [{ text: BTN.enroll }, { text: BTN.contacts }]],
  resize_keyboard: true,
  is_persistent: true,
};

const ASK_PHONE = {
  keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }], [{ text: BTN.back }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function tg(method: string, body: Record<string, unknown>) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error('telegram', method, data.description);
  return data;
}
const send = (chat_id: number, text: string, reply_markup: unknown = MENU) =>
  tg('sendMessage', { chat_id, text, reply_markup, parse_mode: 'HTML', disable_web_page_preview: true });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const money = (n: number) => `${Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;

async function setting(key: string) {
  const { data } = await adminClient().from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? '';
}

async function activeCourses() {
  const { data } = await adminClient().from('courses').select('id,name,price,duration,schedule,topics,description').eq('active', true).order('name');
  return data ?? [];
}

async function showMenu(chat: number, name?: string) {
  const center = await setting('center_name');
  await send(chat, `Assalomu alaykum${name ? ', ' + esc(name) : ''}! 👋\n<b>${esc(center)}</b> botiga xush kelibsiz.\n\nKerakli bo'limni tanlang:`);
}

async function showCourses(chat: number) {
  const list = await activeCourses();
  if (!list.length) return send(chat, "Kurslar ro'yxati tez orada qo'shiladi. Savollar bo'lsa — «📞 Aloqa» bo'limiga qarang.");
  const text = '<b>Bizning kurslar:</b>\n\n' + list.map(c =>
    `🚗 <b>${esc(c.name)}</b>${c.price ? ' — ' + money(c.price) : ''}${c.duration ? '\n⏱ Davomiyligi: ' + esc(c.duration) : ''}`).join('\n\n') +
    '\n\nBatafsil ma\'lumot yoki yozilish uchun kursni tanlang 👇';
  return tg('sendMessage', {
    chat_id: chat, text, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: list.map(c => [{ text: c.name, callback_data: `c:${c.id}` }]) },
  });
}

async function showCourse(chat: number, id: string) {
  const { data: c } = await adminClient().from('courses').select('*').eq('id', id).eq('active', true).maybeSingle();
  if (!c) return send(chat, 'Bu kurs topilmadi.');
  const rows = [
    `🚗 <b>${esc(c.name)}</b>`,
    c.description && esc(c.description),
    c.price && `💰 Narxi: <b>${money(c.price)}</b>`,
    c.duration && `⏱ Davomiyligi: ${esc(c.duration)}`,
    c.schedule && `🗓 Jadval: ${esc(c.schedule)}`,
    c.topics && `📚 Mavzular: ${esc(c.topics)}`,
  ].filter(Boolean);
  return tg('sendMessage', {
    chat_id: chat, text: rows.join('\n'), parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '📝 Shu kursga yozilish', callback_data: `e:${c.id}` }]] },
  });
}

async function askPhone(chat: number, courseId: string | null) {
  await adminClient().from('bot_state').upsert({ chat_id: chat, course_id: courseId, updated_at: new Date().toISOString() });
  let course = '';
  if (courseId) {
    const { data } = await adminClient().from('courses').select('name').eq('id', courseId).maybeSingle();
    if (data) course = ` <b>${esc(data.name)}</b> kursiga`;
  }
  return send(chat, `Ajoyib!${course} yozilish uchun pastdagi tugma orqali telefon raqamingizni yuboring 👇\nMenejerimiz siz bilan bog'lanadi.`, ASK_PHONE);
}

async function register(chat: number, phone: string, firstName: string, lastName: string) {
  const db = adminClient();
  const { data: st } = await db.from('bot_state').select('course_id').eq('chat_id', chat).maybeSingle();
  const { data, error } = await db.rpc('intake_lead', {
    p: {
      first_name: firstName || 'Telegram mijoz', last_name: lastName || '', phone,
      source: 'Telegram', course_id: st?.course_id ?? null, comment: 'Telegram bot orqali ariza',
    },
  });
  if (error) {
    console.error('intake_lead', error);
    return send(chat, "Kechirasiz, raqamni qabul qilib bo'lmadi. Iltimos, raqamni +998 XX XXX XX XX ko'rinishida yuboring.", ASK_PHONE);
  }
  if (data?.id) await db.from('leads').update({ telegram_chat_id: chat }).eq('id', data.id);
  await db.from('bot_state').delete().eq('chat_id', chat);
  return send(chat, data?.duplicate
    ? "Rahmat! Siz avval ham murojaat qilgansiz — arizangiz yangilandi. Menejerimiz tez orada bog'lanadi. ✅"
    : "Rahmat! Arizangiz qabul qilindi ✅\nMenejerimiz tez orada siz bilan bog'lanadi.");
}

async function onMessage(msg: any) {
  const chat: number = msg.chat?.id;
  if (!chat || msg.chat?.type !== 'private') return;
  const text: string = (msg.text ?? '').trim();
  const from = msg.from ?? {};

  // Kontakt yuborildi (faqat o'z raqami)
  if (msg.contact) {
    if (msg.contact.user_id && msg.contact.user_id !== from.id) {
      return send(chat, "Iltimos, o'zingizning raqamingizni «📱 Telefon raqamni yuborish» tugmasi orqali yuboring.", ASK_PHONE);
    }
    return register(chat, msg.contact.phone_number, msg.contact.first_name || from.first_name, msg.contact.last_name || from.last_name);
  }

  // Menejer yuborgan bog'lash havolasi: /start TOKEN
  const m = text.match(/^\/start\s+([A-Za-z0-9_-]{16,64})$/);
  if (m) {
    const { data, error } = await adminClient().rpc('consume_telegram_token', { p_hash: await sha256Hex(m[1]), p_chat: chat });
    if (error) throw error;
    if (!data) return send(chat, "Havola yaroqsiz yoki muddati tugagan. Iltimos, menejeringizdan yangi havola so'rang.");
    return send(chat, data.kind === 'client'
      ? `Assalomu alaykum, ${esc(data.name)}! Siz botga muvaffaqiyatli ulandingiz. To'lov va dars eslatmalarini shu yerda olasiz.`
      : `${esc(data.name)}, siz CRM xabarnomalariga ulandingiz.`);
  }

  if (text.startsWith('/start') || text === BTN.back || text === '/menu') return showMenu(chat, from.first_name);
  if (text === BTN.courses || text === '/kurslar') return showCourses(chat);
  if (text === BTN.about) return send(chat, `ℹ️ <b>Biz haqimizda</b>\n\n${esc(await setting('bot_about'))}`);
  if (text === BTN.contacts) return send(chat, `📞 <b>Aloqa</b>\n\n${esc(await setting('bot_contacts'))}`);
  if (text === BTN.enroll) return askPhone(chat, null);

  // Raqamni qo'lda yozgan bo'lsa (yozilish jarayonida)
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 12 && /^[+\d\s()-]+$/.test(text)) {
    const { data: st } = await adminClient().from('bot_state').select('chat_id').eq('chat_id', chat).maybeSingle();
    if (st) return register(chat, text, from.first_name, from.last_name);
  }
  return send(chat, "Kerakli bo'limni pastdagi menyudan tanlang 👇");
}

async function onCallback(q: any) {
  const chat: number = q.message?.chat?.id;
  await tg('answerCallbackQuery', { callback_query_id: q.id });
  if (!chat) return;
  const [kind, id] = String(q.data ?? '').split(':');
  if (kind === 'c' && id) return showCourse(chat, id);
  if (kind === 'e' && id) return askPhone(chat, id);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('ok');
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json().catch(() => null);
  try {
    if (update?.message) await onMessage(update.message);
    else if (update?.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    console.error('telegram-webhook', e);
  }
  // Telegram qayta yubormasligi uchun har doim 200
  return new Response('ok');
});
