import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Yangi kalitlar (sb_secret_ / sb_publishable_) secrets orqali beriladi: SB_SECRET_KEY, SB_PUBLISHABLE_KEY.
// Eski (legacy) JWT kalitlar o'chirilgan bo'lsa ham ishlaydi; yangilari bo'lmasa eskisiga qaytadi.
const SECRET_KEY = () => Deno.env.get('SB_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_KEY = () => Deno.env.get('SB_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;

// Service role klienti — RLS'ni chetlab o'tadi, faqat serverda ishlatiladi
export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, SECRET_KEY(), {
    auth: { persistSession: false },
  });
}

// So'rov yuborgan foydalanuvchi nomidan ishlaydigan klient (RLS amal qiladi)
export function userClient(req: Request) {
  return createClient(Deno.env.get('SUPABASE_URL')!, PUBLIC_KEY(), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

// Taymingga chidamli satr solishtirish (maxfiy kalitlar uchun)
export function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sendTelegram(chatId: number | string, text: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram xatosi ${res.status}`);
}
