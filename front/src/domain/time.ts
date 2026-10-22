/** Работа с датами. Выходные — суббота и воскресенье, праздники не учитываем (допущение демо). */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Плюс N рабочих дней с сохранением времени суток. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY);

/** Полных месяцев между датами */
export function monthsBetween(from: Date, to: Date) {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m--;
  return Math.max(0, m);
}

export const iso = (d: Date) => d.toISOString();
