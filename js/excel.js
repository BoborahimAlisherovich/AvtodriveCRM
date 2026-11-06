// Excel eksport/import. SheetJS kutubxonasi faqat kerak bo'lganda yuklanadi,
// shuning uchun asosiy sahifa tezligiga ta'sir qilmaydi.
const SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let loading = null;

function lib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { loading = null; reject(new Error("Excel kutubxonasini yuklab bo'lmadi. Internetni tekshiring")); };
    document.head.append(s);
  });
  return loading;
}

// sheets: [{ name, rows: [{ "Ustun nomi": qiymat }] }]
export async function exportExcel(filename, sheets) {
  const X = await lib();
  const wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.json_to_sheet(s.rows.length ? s.rows : [{ "Ma'lumot yo'q": '' }]);
    const keys = Object.keys(s.rows[0] || { x: '' });
    ws['!cols'] = keys.map(k => ({ wch: Math.min(40, Math.max(k.length, ...s.rows.slice(0, 200).map(r => String(r[k] ?? '').length)) + 2) }));
    X.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  }
  X.writeFile(wb, filename);
}

export async function readExcel(file) {
  const X = await lib();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => ({ name, rows: X.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false }) }));
}

// Ustun nomlarini avtomatik aniqlash (Ism, Familiya, Telefon ...)
const GUESS = [
  ['full_name', /^(f\.?\s*i\.?\s*o|fio|ism\s*familiya|mijoz|full\s*name|name)$/i],
  ['first_name', /^(ism|ismi|first\s*name|имя)$/i],
  ['last_name', /^(familiya|familiyasi|last\s*name|фамилия)$/i],
  ['phone', /(tel|phone|raqam|номер)/i],
  ['source', /(manba|source|источник)/i],
  ['owner', /(sotuvchi|menejer|manager|mas.?ul)/i],
  ['course', /(kurs|course|yo.?nalish)/i],
  ['comment', /(izoh|comment|koment|примеч)/i],
  ['date', /(sana|date|дата)/i],
];
export const IMPORT_FIELDS = {
  full_name: 'Ism familiya (bitta ustun)', first_name: 'Ism', last_name: 'Familiya', phone: 'Telefon',
  source: 'Manba', owner: 'Sotuvchi', course: 'Kurs', comment: 'Izoh', date: 'Sana',
};
export function guessMapping(headers) {
  const map = {};
  for (const h of headers) {
    const key = String(h).trim();
    const hit = GUESS.find(([f, re]) => re.test(key) && !Object.values(map).includes(f));
    if (hit) map[h] = hit[0];
  }
  return map;
}
export function applyMapping(rows, map) {
  return rows.map(r => {
    const o = {};
    for (const [col, field] of Object.entries(map)) if (field) o[field] = r[col];
    if (o.full_name && !o.first_name) {
      const parts = String(o.full_name).trim().split(/\s+/);
      o.first_name = parts[0] || '';
      o.last_name = parts.slice(1).join(' ');
    }
    return o;
  });
}
