// Demo ma'lumotlar: xodimlar, statuslar, kurslar, ~160 lead, to'lovlar, davomat.
const FN_M = ['Aziz', 'Jasur', 'Sardor', 'Bekzod', 'Otabek', 'Javohir', 'Sherzod', "Ulug'bek", 'Doniyor', 'Islom', 'Shohruh', 'Akmal', 'Farrux', 'Bobur', 'Diyor'];
const FN_F = ['Dilnoza', 'Madina', 'Shahzoda', 'Nodira', 'Malika', 'Zarina', 'Gulnora', 'Kamola', 'Sevara', 'Mohira', 'Nilufar', 'Feruza', 'Laylo', 'Sabina'];
const LN = ['Karimov', 'Rahimov', 'Toshmatov', 'Yusupov', 'Abdullayev', 'Nazarov', 'Ergashev', 'Qodirov', 'Sobirov', 'Mirzayev', 'Xolmatov', 'Islomov', 'Hasanov', 'Alimov', 'Umarov'];
const NOTES = [
  "Qo'ng'iroq qilindi, ertaga qayta bog'lanishni so'radi",
  "Narxlar haqida ma'lumot berildi",
  'Sinov darsiga taklif qilindi',
  'Telegramdan dars jadvali yuborildi',
  "Ota-onasi bilan maslahatlashib javob beradi",
  'Kechki guruhni xohlaydi',
];

export const STATUS_SEED = [
  ['st_new', 'Yangi Lead', '#2fc6f6', 'new'],
  ['st_contacted', 'Aloqa qilindi', '#39b5d6', null],
  ['st_noanswer', 'Javob bermadi', '#ff7a76', 'noanswer'],
  ['st_callback', "Qayta qo'ng'iroq", '#ffa900', null],
  ['st_interest', 'Qiziqmoqda', '#a77bde', null],
  ['st_trial', 'Sinov darsiga yozildi', '#5b8def', null],
  ['st_attended', 'Darsga keldi', '#3cc3a6', null],
  ['st_waitpay', "To'lov kutilmoqda", '#e8b400', null],
  ['st_won', 'Sotuv amalga oshdi', '#7bd500', 'won'],
  ['st_lost', 'Bekor qilindi', '#9aa3ab', 'lost'],
];

function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
const z = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const DAY = 864e5;

export function seed() {
  const R = rng(20261104);
  const pick = a => a[Math.floor(R() * a.length)];
  const weighted = pairs => {
    const sum = pairs.reduce((s, p) => s + p[1], 0);
    let x = R() * sum;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
    return pairs[0][0];
  };
  const now = new Date();
  const ago = d => new Date(now.getTime() - d * DAY);

  const profiles = [
    { id: 'u_admin', full_name: 'Bosh Administrator', phone: '+998901000001', email: 'admin@bvaexpress.uz', role: 'admin', position: 'Direktor' },
    { id: 'u_roop', full_name: 'Operatsion menejer', phone: '+998901000002', email: 'roop@bvaexpress.uz', role: 'roop', position: 'ROOP' },
    { id: 'u_rozali', full_name: "Ro'zali", phone: '+998901000003', email: 'rozali@bvaexpress.uz', role: 'seller', position: 'Sotuv menejeri' },
    { id: 'u_kozim', full_name: 'Kozimjon', phone: '+998901000004', email: 'kozimjon@bvaexpress.uz', role: 'seller', position: 'Sotuv menejeri' },
    { id: 'u_davlet', full_name: 'Davlet', phone: '+998901000005', email: 'davlet@bvaexpress.uz', role: 'seller', position: 'Sotuv menejeri' },
  ].map((p, i) => ({
    work_start: '09:00', work_end: '18:00', schedule: 'Du–Sha', active: true,
    birthday: `199${i}-0${(i % 9) + 1}-1${i}`, telegram_chat_id: null, created_at: ago(90).toISOString(), ...p,
  }));
  const sellers = ['u_rozali', 'u_kozim', 'u_davlet'];

  const lead_statuses = STATUS_SEED.map(([id, name, color, kind], i) => ({
    id, name, color, kind, sort: i + 1, is_system: !!kind,
  }));

  const courses = [
    { id: 'c_eng', name: 'Ingliz tili (General)', price: 1800000, duration: '3 oy', schedule: 'Du-Chor-Ju, 18:00–19:30', teacher: 'Nodira Karimova', topics: 'Grammar, Speaking, Listening, Vocabulary' },
    { id: 'c_ielts', name: 'IELTS tayyorlov', price: 2400000, duration: '3 oy', schedule: 'Se-Pa-Sha, 16:00–18:00', teacher: 'Jasur Rahimov', topics: 'Reading, Writing Task 1-2, Speaking, Mock test' },
    { id: 'c_rus', name: 'Rus tili', price: 1500000, duration: '3 oy', schedule: 'Du-Chor-Ju, 15:00–16:30', teacher: 'Olga Petrova', topics: "So'zlashuv, Grammatika, Yozuv" },
    { id: 'c_math', name: 'Matematika', price: 1200000, duration: '2 oy', schedule: 'Se-Pa, 17:00–18:30', teacher: 'Bekzod Sobirov', topics: 'Algebra, Geometriya, Test yechish' },
    { id: 'c_it', name: 'Kompyuter savodxonligi', price: 900000, duration: '1.5 oy', schedule: 'Sha, 10:00–13:00', teacher: 'Akmal Umarov', topics: "Word, Excel, Internet, Telegram bot asoslari" },
  ].map(c => ({ ...c, description: `${c.name} kursi — boshlang'ichdan yuqori darajagacha.`, active: true, created_at: ago(120).toISOString() }));

  const settings = {
    center_name: 'B va Express',
    bot_username: 'BvaExpressBot',
    sources: ['Instagram reklama', 'Telegram', 'Sayt', 'Telefon', "Qo'lda kiritish", 'Excel import', 'Tavsiya'],
    rr_order: [...sellers],
    rr_last: 'u_davlet',
    require_attendance: true,
    seller_can_transfer: true,
    remind_days_before: 3,
  };

  const leads = [], lead_notes = [], lead_assignments = [], payments = [], payment_history = [], activity_logs = [], notifications = [];
  let n = 0;
  const id = p => `${p}_seed${(++n).toString(36)}`;

  const STATUS_W = [['st_new', 6], ['st_contacted', 10], ['st_noanswer', 10], ['st_callback', 8], ['st_interest', 8], ['st_trial', 6], ['st_attended', 5], ['st_waitpay', 6], ['st_won', 20], ['st_lost', 12]];
  const SRC_W = [['Instagram reklama', 45], ['Telegram', 20], ['Sayt', 10], ['Telefon', 10], ["Qo'lda kiritish", 8], ['Tavsiya', 7]];
  const phones = new Set();
  let rr = 0;

  for (let i = 0; i < 160; i++) {
    const age = Math.pow(R(), 1.3) * 50;
    const created = ago(age);
    created.setHours(9 + Math.floor(R() * 10), Math.floor(R() * 60));
    if (created > now) created.setTime(now.getTime() - 30 * 60000);
    const female = R() < 0.5;
    let last = pick(LN);
    if (female) last += 'a';
    let phone;
    do { phone = '+998' + pick(['90', '91', '93', '94', '97', '99', '88', '33']) + String(Math.floor(1e6 + R() * 8999999)); } while (phones.has(phone));
    phones.add(phone);
    const status = age < 1 ? (R() < .7 ? 'st_new' : 'st_contacted') : weighted(STATUS_W);
    let owner = sellers[rr++ % 3];
    const course = R() < .85 ? pick(courses).id : null;
    const lead = {
      id: id('l'), first_name: pick(female ? FN_F : FN_M), last_name: last, phone,
      source: weighted(SRC_W), owner_id: owner, status_id: status, course_id: course,
      created_at: created.toISOString(), next_contact_at: null, comment: '',
      birthday: null, telegram_chat_id: R() < .15 ? String(5e8 + Math.floor(R() * 1e8)) : null,
      created_by: null,
    };
    if (['st_callback', 'st_interest', 'st_waitpay', 'st_trial'].includes(status)) {
      const d = new Date(now.getTime() + (Math.floor(R() * 6) - 2) * DAY);
      d.setHours(10 + Math.floor(R() * 7), R() < .5 ? 0 : 30, 0, 0);
      lead.next_contact_at = d.toISOString();
    }
    lead_assignments.push({ id: id('as'), lead_id: lead.id, from_id: null, to_id: owner, by_id: null, reason: 'Avtomatik taqsimot (Round Robin)', created_at: lead.created_at });
    activity_logs.push({ id: id('log'), user_id: null, action: 'lead.create', entity: 'lead', entity_id: lead.id, label: `${lead.first_name} ${lead.last_name}`, old: null, new: lead.source, created_at: lead.created_at });

    if (age > 2 && R() < .08) {
      const to = pick(sellers.filter(s => s !== owner));
      const at = new Date(created.getTime() + DAY).toISOString();
      const by = R() < .5 ? 'u_roop' : owner;
      lead_assignments.push({ id: id('as'), lead_id: lead.id, from_id: owner, to_id: to, by_id: by, reason: pick(['Mijoz rus tilida gaplashadi', "Sotuvchi so'rovi", 'Ish yuklamasi']), created_at: at });
      activity_logs.push({ id: id('log'), user_id: by, action: 'lead.transfer', entity: 'lead', entity_id: lead.id, label: `${lead.first_name} ${lead.last_name}`, old: owner, new: to, created_at: at });
      owner = lead.owner_id = to;
    }
    if (status !== 'st_new' && R() < .45) {
      const cnt = 1 + Math.floor(R() * 2);
      for (let k = 0; k < cnt; k++) {
        const at = new Date(Math.min(now.getTime(), created.getTime() + (k + 1) * DAY * R() * 2)).toISOString();
        lead_notes.push({ id: id('nt'), lead_id: lead.id, author_id: owner, text: pick(NOTES), created_at: at });
      }
    }
    if (status === 'st_won') {
      const c = courses.find(c => c.id === course) || courses[0];
      lead.course_id = c.id;
      const pAt = new Date(Math.min(now.getTime() - 3600e3, created.getTime() + (2 + R() * 3) * DAY));
      const scenario = weighted([['full', 45], ['partial', 35], ['late', 20]]);
      const first = scenario === 'full' ? c.price : Math.round(c.price * pick([.3, .4, .5]) / 1000) * 1000;
      let due = new Date(pAt.getTime() + 30 * DAY);
      if (scenario === 'late') due = new Date(Math.min(pAt.getTime() + 7 * DAY, now.getTime() - 3 * DAY));
      const p = {
        id: id('p'), lead_id: lead.id, course_id: c.id, total: c.price, paid: first,
        due_date: ymd(due), next_date: scenario === 'full' ? null : ymd(due), note: '',
        cancelled: false, cancel_reason: '', created_by: owner, created_at: pAt.toISOString(),
      };
      payments.push(p);
      payment_history.push({ id: id('ph'), payment_id: p.id, user_id: owner, action: 'create', amount: p.total, old: null, new: null, note: '', created_at: p.created_at });
      payment_history.push({ id: id('ph'), payment_id: p.id, user_id: owner, action: 'pay', amount: first, old: null, new: null, note: "Boshlang'ich to'lov", created_at: p.created_at });
      activity_logs.push({ id: id('log'), user_id: owner, action: 'pay.create', entity: 'payment', entity_id: p.id, label: `${lead.first_name} ${lead.last_name}`, old: null, new: p.total, created_at: p.created_at });
      if (scenario === 'partial' && R() < .4 && age > 10) {
        const extra = Math.round((p.total - p.paid) / 2 / 1000) * 1000;
        const at = new Date(pAt.getTime() + 8 * DAY).toISOString();
        p.paid += extra;
        payment_history.push({ id: id('ph'), payment_id: p.id, user_id: owner, action: 'pay', amount: extra, old: null, new: null, note: "Qisman to'lov", created_at: at });
      }
    }
    leads.push(lead);
  }

  // Davomat: so'nggi 30 kun, yakshanba — dam olish kuni
  const attendance = [];
  for (let d = 30; d >= 1; d--) {
    const day = ago(d);
    const date = ymd(day);
    for (const p of profiles) {
      const status = day.getDay() === 0 ? 'dam' : weighted([['ishda', 85], ['kechikdi', 8], ['kelmadi', 4], ['ruxsat', 3]]);
      attendance.push({ id: id('at'), profile_id: p.id, date, status, note: '', updated_by: 'u_admin', updated_at: day.toISOString() });
    }
  }
  const today = ymd(now);
  for (const p of profiles) {
    attendance.push({ id: id('at'), profile_id: p.id, date: today, status: p.id === 'u_kozim' ? 'kelmadi' : 'ishda', note: p.id === 'u_kozim' ? 'Kasal' : '', updated_by: 'u_admin', updated_at: now.toISOString() });
  }

  // Telegram xabarnomalar tarixi
  const sorted = [...leads].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const l of sorted.slice(0, 12)) {
    const owner = profiles.find(p => p.id === l.owner_id);
    notifications.push({ id: id('nf'), channel: 'telegram', audience: 'staff', recipient_id: owner.id, recipient: owner.full_name, kind: 'lead.assigned', text: `Sizga yangi lead biriktirildi: ${l.first_name} ${l.last_name}`, status: 'sent', attempts: 1, error: '', created_at: l.created_at });
  }
  for (const p of payments.slice(0, 6)) {
    const l = leads.find(x => x.id === p.lead_id);
    notifications.push({ id: id('nf'), channel: 'telegram', audience: 'client', recipient_id: l.id, recipient: `${l.first_name} ${l.last_name}`, kind: 'pay.received', text: "To'lovingiz qabul qilindi. Rahmat!", status: l.telegram_chat_id ? 'sent' : 'failed', attempts: l.telegram_chat_id ? 1 : 3, error: l.telegram_chat_id ? '' : 'Mijoz botga ulanmagan', created_at: p.created_at });
  }

  activity_logs.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    profiles, lead_statuses, leads, lead_notes, lead_assignments, courses, payments, payment_history,
    attendance, activity_logs, telegram_links: [], notifications, settings,
  };
}
