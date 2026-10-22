const numberFormat = new Intl.NumberFormat('ru-RU');
const centsFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rub = (value: number) => `${numberFormat.format(Math.round(value))} ₽`;
export const rubCents = (value: number) => `${centsFormat.format(value)} ₽`;

export function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const months = (n: number) => `${n} ${plural(n, ['месяц', 'месяца', 'месяцев'])}`;

/** 2 000 000 → «2 млн», 500 000 → «500 тыс.» */
export function shortAmount(value: number) {
  if (value >= 1_000_000) {
    const mln = value / 1_000_000;
    return `${Number.isInteger(mln) ? mln : mln.toFixed(2).replace(/0+$/, '').replace('.', ',')} млн`;
  }
  return `${Math.round(value / 1000)} тыс.`;
}

export const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const timeNow = () => time(new Date().toISOString());

export function dateTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Сегодня, ${time(iso)}` : `${dayMonth(iso)}, ${time(iso)}`;
}

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;

export const maskTail = (value: string, visible = 4) => '•'.repeat(Math.max(0, value.length - visible)) + value.slice(-visible);

/** Название прошлого месяца в винительном падеже: «за сентябрь». */
export function previousMonthName(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.toLocaleDateString('ru-RU', { month: 'long' });
}
