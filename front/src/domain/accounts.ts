import type { Account } from './types.ts';

/** Счета компании для зачисления. Если для компании их нет в демо-данных — два синтетических. */
export function accountsFor(inn: string, known: Account[]): Account[] {
  const own = known.filter((a) => a.companyInn === inn);
  if (own.length) return own;
  const tail = inn.slice(-6).padStart(6, '0');
  return [
    { number: `40702810${tail}00012345`.slice(0, 20), title: 'Расчётный счёт', companyInn: inn },
    { number: `40702810${tail}00067890`.slice(0, 20), title: 'Дополнительный счёт', companyInn: inn },
  ];
}
