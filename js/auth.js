// Joriy foydalanuvchi va rollar bo'yicha huquqlar.
// Muhim: bu faqat interfeys uchun (tugmalarni ko'rsatish/yashirish). Haqiqiy tekshiruv
// Supabase'da RLS va database funksiyalarida bajariladi.

export const ROLES = { admin: 'FULL ADMIN', roop: 'ROOP', seller: 'Sotuvchi' };

let current = null;
let getSettings = () => ({});

// Adapter (demo yoki Supabase) kirish/chiqishda chaqiradi
export function setSession(user, settingsFn) {
  current = user || null;
  if (settingsFn) getSettings = settingsFn;
}

export function me() {
  return current && current.active ? current : null;
}

const RULES = {
  'leads.all': ['admin', 'roop'],
  'leads.bulk': ['admin', 'roop'],
  'leads.assign': ['admin', 'roop'],
  'leads.import': ['admin', 'roop'],
  'leads.delete': ['admin'],
  'stages.manage': ['admin', 'roop'],
  'payments.all': ['admin', 'roop'],
  'payments.create': ['admin', 'roop', 'seller'],
  'payments.receive': ['admin', 'roop', 'seller'],
  'payments.edit': ['admin'],
  'staff.manage': ['admin'],
  'attendance.view': ['admin', 'roop'],
  'attendance.edit': ['admin'],
  'reports.view': ['admin', 'roop'],
  'logs.all': ['admin', 'roop'],
  'courses.manage': ['admin'],
  'telegram.view': ['admin', 'roop'],
  'settings.manage': ['admin'],
  'export.all': ['admin'],
};

export function can(action) {
  const u = me();
  if (!u) return false;
  if (action === 'leads.transfer') {
    return u.role !== 'seller' || !!getSettings().seller_can_transfer;
  }
  return (RULES[action] || []).includes(u.role);
}
