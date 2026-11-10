// CRM API: sahifalar faqat shu moduldan foydalanadi.
// config.js to'ldirilgan bo'lsa Supabase, aks holda demo adapter ishlaydi.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import * as demo from './demo.js';
import * as cloud from './supabase.js';

const impl = SUPABASE_URL && SUPABASE_ANON_KEY ? cloud : demo;

export const {
  mode, init, signIn, signOut, demoUsers, resetDemo, badges,
  leads, stages, courses, staff, payments, attendance, reports, dashboard, logs, telegram, settings, integrations,
  profileName, isAtWork, backupTables,
} = impl;

export { ymd, today, dayOf, normPhone, ACTIONS, PAY_STATUS, payStatus, ATT, workedMinutes, hhmm } from './common.js';
