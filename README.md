# B va Express CRM

Oddiy HTML/CSS/JS frontend (build kerak emas) + Supabase backend (PostgreSQL, Auth, RLS, Edge Functions, Cron).

- `js/config.js` **bo'sh** bo'lsa — ilova **demo rejimda** ishlaydi (ma'lumotlar brauzerda).
- `js/config.js` to'ldirilsa — haqiqiy **Supabase** bazasi bilan ishlaydi.

## Lokal ishga tushirish

```bash
python -m http.server 5173
```

Keyin http://localhost:5173 ni oching.

---

## Supabase'ni ulash (bir martalik)

### 1. Loyiha yaratish
1. https://supabase.com → **New project**. Region: **Frankfurt (eu-central-1)** — O'zbekistonga eng yaqini.
2. Database parolini xavfsiz joyga saqlang.

### 2. Bazani yaratish
**SQL Editor** → har bir faylni tartib bilan nusxalab, **Run** bosing:
1. `supabase/migrations/0001_schema.sql` — jadvallar, indekslar, statuslar, sozlamalar
2. `supabase/migrations/0002_functions.sql` — biznes funksiyalari (Round Robin, to'lovlar, hisobotlar…)
3. `supabase/migrations/0003_security.sql` — RLS va huquqlar
4. `supabase/migrations/0005_status_changed_at.sql` — Kanban: bosqichga o'tkazilgan vaqt, "Sizga o'tkazilgan" belgisi
5. `supabase/migrations/0006_service_role_grants.sql` — Edge Functions (service_role) uchun jadval huquqlari
6. `supabase/migrations/0007_bot_menu.sql` — Telegram bot menyusi (Biz haqimizda, Aloqa matnlari)

### 3. Autentifikatsiya
1. **Authentication → Sign In / Providers → Email**: **"Allow new users to sign up"** ni o'chiring
   (xodimlarni faqat admin qo'shadi; o'chirilmasa ham begona foydalanuvchi nofaol bo'lib qoladi va hech narsa ko'rmaydi).
2. **Authentication → URL Configuration → Site URL**: saytingiz manzili (masalan `https://bvaexpress-crm.netlify.app`).
3. **Authentication → Users → Add user**: o'z emailingiz va parol, **Auto Confirm** belgilang.
   → **Eng birinchi foydalanuvchi avtomatik FULL ADMIN bo'ladi.**

### 4. Frontendni ulash
**Project Settings → API** dan `Project URL` va `anon public` kalitni `js/config.js` ga yozing.
`service_role` kalitni **hech qachon** frontendga yozmang.

### 5. Edge Functions (xodim qo'shish, Telegram, tashqi leadlar)
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <PROJECT_REF>
```
```bash
npx supabase functions deploy invite-staff telegram-webhook notify-dispatch lead-intake
```
```bash
npx supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<tasodifiy-uzun-satr> CRON_SECRET=<tasodifiy-uzun-satr> INTAKE_API_KEY=<tasodifiy-uzun-satr>
```

| Funksiya | Vazifasi |
|---|---|
| `invite-staff` | Yangi xodim qo'shish (faqat FULL ADMIN). Parol berilsa darhol kiradi, berilmasa emailga taklif boradi |
| `telegram-webhook` | Mijoz/xodim `/start TOKEN` bosganda chat_id ni CRMga bog'laydi |
| `notify-dispatch` | Navbatdagi Telegram xabarlarini yuboradi (3 marta qayta urinadi) |
| `lead-intake` | Instagram/sayt/Telegram formalaridan lead qabul qiladi (`x-api-key` bilan) |

### 6. Telegram bot
1. @BotFather → `/newbot` → token oling (5-qadamdagi `TELEGRAM_BOT_TOKEN`).
2. Webhookni ulang (brauzerda oching):
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
3. CRM → Sozlamalar → bot username'ni yozing.

### 7. Avtomatlashtirish (Cron)
1. **Database → Extensions**: `pg_cron` va `pg_net` ni yoqing.
2. `supabase/migrations/0004_cron.sql` dagi `<PROJECT_REF>` va `<CRON_SECRET>` ni almashtirib, SQL Editor'da ishga tushiring.
   - har kuni 09:00 — to'lov eslatmalari, qarzdorlik, tug'ilgan kunlar, kunlik hisobot
   - har daqiqada — Telegram xabarlarini yuborish

### 8. Saytni joylash (Netlify)
https://app.netlify.com/drop ga loyiha papkasini tashlang (`supabase/` papkasi shart emas).

### 9. Birinchi sozlash
CRMga admin bo'lib kiring → **Kurslar** qo'shing → **Xodimlar**: ROOP, Ro'zali, Kozimjon, Davlet → **Sozlamalar**: navbat tartibi.

---

## Xavfsizlik qanday ishlaydi
- Jadvallardan faqat **o'qish** mumkin va RLS rolga qarab cheklaydi (sotuvchi faqat o'z leadlari/to'lovlarini ko'radi).
- **Yozish** faqat database funksiyalari orqali: har biri rolni tekshiradi va Activity Logga yozadi.
  To'lov summasi/muddatini o'zgartirish va bekor qilish — faqat FULL ADMIN.
- Activity Logni hech kim o'zgartira yoki o'chira olmaydi.
- Telegram token bazada faqat sha256 hash ko'rinishida, bir martalik, 24 soat amal qiladi.
- Bot token va service role kaliti faqat Edge Function secrets'da.

## Tuzilishi

| Fayl | Vazifasi |
|---|---|
| `js/data/api.js` | Sahifalar shu orqali ishlaydi; demo yoki Supabase adapterini tanlaydi |
| `js/data/supabase.js` | Supabase adapteri (ma'lumotnomalar keshlanadi — tez) |
| `js/data/demo.js`, `db.js`, `seed.js` | Demo adapter va namunaviy ma'lumotlar |
| `js/pages/*`, `js/components/*` | Sahifalar, lead kartasi, to'lov oynalari |
| `supabase/migrations/*` | Baza tuzilishi, funksiyalar, RLS, Cron |
| `supabase/functions/*` | Edge Functions |

## Qisqa tugmalar
`/` — qidiruv · `N` — yangi lead · `Esc` — yopish · `Ctrl+Enter` — izohni saqlash
