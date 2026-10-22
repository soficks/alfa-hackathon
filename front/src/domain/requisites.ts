import type { LegalForm } from './types.ts';

const digits = (s: string) => s.split('').map(Number);

const weighted = (ds: number[], weights: number[]) => (weights.reduce((sum, w, i) => sum + w * ds[i], 0) % 11) % 10;

const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

export function isValidInn(inn: string): boolean {
  if (/^\d{10}$/.test(inn)) {
    const d = digits(inn);
    return weighted(d, W10) === d[9];
  }
  if (/^\d{12}$/.test(inn)) {
    const d = digits(inn);
    return weighted(d, W11) === d[10] && weighted(d, W12) === d[11];
  }
  return false;
}

/** Форма бизнеса по длине ИНН: 10 цифр — юрлицо, 12 — ИП. */
export function formByInn(inn: string): LegalForm | null {
  if (/^\d{10}$/.test(inn)) return 'ООО';
  if (/^\d{12}$/.test(inn)) return 'ИП';
  return null;
}

/** ОГРН (13 цифр): остаток от деления первых 12 на 11, затем по модулю 10. */
export function isValidOgrn(ogrn: string): boolean {
  if (!/^\d{13}$/.test(ogrn)) return false;
  return (Number(ogrn.slice(0, 12)) % 11) % 10 === Number(ogrn[12]);
}

/** ОГРНИП (15 цифр): остаток от деления первых 14 на 13, затем по модулю 10. */
export function isValidOgrnip(ogrnip: string): boolean {
  if (!/^\d{15}$/.test(ogrnip)) return false;
  return (Number(ogrnip.slice(0, 14)) % 13) % 10 === Number(ogrnip[14]);
}

export const isValidRegistrationNumber = (value: string, form: LegalForm) =>
  form === 'ИП' ? isValidOgrnip(value) : isValidOgrn(value);

export interface InnCheck {
  ok: boolean;
  form?: LegalForm;
  error?: string;
}

export function checkInn(raw: string): InnCheck {
  const inn = raw.replace(/\s/g, '');
  if (!/^\d+$/.test(inn)) return { ok: false, error: 'ИНН состоит только из цифр' };
  const form = formByInn(inn);
  if (!form) return { ok: false, error: 'ИНН компании — 10 цифр, ИНН ИП — 12 цифр' };
  if (!isValidInn(inn)) return { ok: false, form, error: 'Похоже, в ИНН опечатка: не сходится контрольное число' };
  return { ok: true, form };
}

/* ---------- Генерация валидных номеров (для моков и тестов) ---------- */

export function completeInn10(prefix9: string) {
  return prefix9 + weighted(digits(prefix9), W10);
}

export function completeInn12(prefix10: string) {
  const n11 = weighted(digits(prefix10), W11);
  const p11 = prefix10 + n11;
  return p11 + weighted(digits(p11), W12);
}

export const completeOgrn = (prefix12: string) => prefix12 + ((Number(prefix12) % 11) % 10);

export const completeOgrnip = (prefix14: string) => prefix14 + ((Number(prefix14) % 13) % 10);
