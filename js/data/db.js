// Demo ma'lumotlar bazasi (brauzer xotirasida).
// Jadvallar Supabase'dagi jadvallar bilan bir xil nomlangan; keyin bu fayl o'rniga
// Supabase klienti ulanadi, api.js ning interfeysi o'zgarmaydi.
import { seed } from './seed.js';

const KEY = 'bxcrm.db.v1';
export let db;
const cache = {};

export function loadDb() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { db = JSON.parse(raw); return; }
  } catch { /* xotira yopiq bo'lsa demo ma'lumot bilan ishlaymiz */ }
  db = seed();
  flush();
}

let timer;
export function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 120);
}

function flush() {
  clearTimeout(timer);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ }
}
addEventListener('beforeunload', flush);

export function resetDb() {
  db = seed();
  for (const k in cache) delete cache[k];
  flush();
}

// id bo'yicha tez qidirish (jadval o'zgarsa indeks qayta quriladi)
export function byId(table, id) {
  if (!id) return null;
  const arr = db[table];
  let c = cache[table];
  if (!c || c.arr !== arr || c.n !== arr.length) {
    c = cache[table] = { arr, n: arr.length, m: new Map(arr.map(r => [r.id, r])) };
  }
  return c.m.get(id) || null;
}

export function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
