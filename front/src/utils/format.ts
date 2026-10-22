const numberFormat = new Intl.NumberFormat('ru-RU');
const centsFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2 000 000 ₽ — без копеек */
export const rub = (value: number) => `${numberFormat.format(Math.round(value))} ₽`;
/** 2 000 000,00 — для таблиц, где ₽ в заголовке */
export const money = (value: number) => centsFormat.format(value);
export const rubCents = (value: number) => `${money(value)} ₽`;
export const num = (value: number) => numberFormat.format(Math.round(value));

export function plural(n: number, forms: [string, string, string]) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const months = (n: number) => `${n} ${plural(n, ['месяц', 'месяца', 'месяцев'])}`;

/** Срок работы бизнеса: «4 года», «8 месяцев», «1 год 3 месяца» */
export function businessAge(totalMonths: number) {
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  const years = y ? `${y} ${plural(y, ['год', 'года', 'лет'])}` : '';
  const mon = m ? `${m} ${plural(m, ['месяц', 'месяца', 'месяцев'])}` : '';
  return [years, mon].filter(Boolean).join(' ') || 'меньше месяца';
}

/** 2 000 000 → «2 млн», 500 000 → «500 тыс.» */
export function shortAmount(value: number) {
  if (value >= 1_000_000) {
    const mln = value / 1_000_000;
    return `${Number.isInteger(mln) ? mln : mln.toFixed(2).replace(/0+$/, '').replace('.', ',')} млн`;
  }
  return `${Math.round(value / 1000)} тыс.`;
}

/** 42 млн ₽, 3,5 млн ₽, 850 тыс. ₽ */
export const compactRub = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} млн ₽` : `${Math.round(value / 1000)} тыс. ₽`;

export const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits).replace('.', ',')}%`;

export const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export const fullDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export const numericDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');

export const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const timeNow = () => time(new Date().toISOString());

/** 22.10, 13:42 */
export const dateTimeShort = (iso: string) =>
  `${new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${time(iso)}`;

/** «Сегодня, 18:00», «Завтра, 12:00», «Вчера, 9:10», иначе «24 октября, 11:20» */
export function dateTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const label = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : dayMonth(iso);
  return `${label}, ${time(iso)}`;
}

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;

export const maskTail = (value: string, visible = 4) => '•'.repeat(Math.max(0, value.length - visible)) + value.slice(-visible);

/** Название прошлого месяца: «сентябрь» */
export function previousMonthName(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.toLocaleDateString('ru-RU', { month: 'long' });
}

export const initials = (firstName: string, lastName: string) => `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
