// Demo va Supabase adapterlari uchun umumiy yordamchilar va ma'lumotnomalar.
const z = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const today = () => ymd(new Date());
export const dayOf = iso => (iso ? ymd(new Date(iso)) : '');
export const fullName = l => `${l.first_name || ''} ${l.last_name || ''}`.trim();

export function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  if (d.length === 10 && d.startsWith('8')) d = '998' + d.slice(1);
  return d ? '+' + d : '';
}

export const ACTIONS = {
  'lead.create': "Lead qo'shildi",
  'lead.edit': 'Lead tahrirlandi',
  'lead.status': "Status o'zgardi",
  'lead.note': "Izoh qo'shildi",
  'lead.transfer': "Lead o'tkazildi",
  'lead.assign': 'Lead biriktirildi',
  'lead.delete': "Lead o'chirildi",
  'lead.import': 'Excel import',
  'pay.create': "To'lov yaratildi",
  'pay.receive': "To'lov qabul qilindi",
  'pay.edit': "To'lov tahrirlandi",
  'pay.cancel': "To'lov bekor qilindi",
  'att.set': "Davomat o'zgardi",
  'staff.create': "Xodim qo'shildi",
  'staff.edit': 'Xodim tahrirlandi',
  'stage.create': "Bosqich qo'shildi",
  'stage.edit': 'Bosqich tahrirlandi',
  'stage.delete': "Bosqich o'chirildi",
  'course.create': "Kurs qo'shildi",
  'course.edit': 'Kurs tahrirlandi',
  'settings.edit': "Sozlamalar o'zgardi",
  'tg.link': 'Telegram havola yaratildi',
};

export const PAY_STATUS = {
  boshlangich: { name: "Boshlang'ich to'lov", color: '#2fc6f6' },
  qarzdor: { name: 'Qarzdorlik', color: '#ff5752' },
  tolangan: { name: "To'langan", color: '#7bd500' },
  bekor: { name: 'Bekor qilingan', color: '#9aa3ab' },
};

export function payStatus(p, t = today()) {
  if (p.cancelled) return 'bekor';
  if (p.total - p.paid <= 0) return 'tolangan';
  const due = p.next_date || p.due_date;
  if (due && due < t) return 'qarzdor';
  return 'boshlangich';
}

export const ATT = {
  ishda: { name: 'Ishda', color: '#7bd500' },
  kechikdi: { name: 'Kechikdi', color: '#ffa900' },
  kelmadi: { name: 'Ishga kelmadi', color: '#ff5752' },
  ruxsat: { name: "Ruxsat bilan yo'q", color: '#a77bde' },
  dam: { name: 'Dam olish kuni', color: '#9aa3ab' },
};
