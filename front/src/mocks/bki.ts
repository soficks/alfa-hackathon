import type { CreditHistory, OverdueCategory } from '../domain/types.ts';
import { between, intBetween, rng } from './random.ts';

/** Мок бюро кредитных историй: компания и руководитель, детерминированно по ИНН. */
export interface BkiReport {
  inn: string;
  loans: number;
  totalDebt: number;
  monthlyPayments: number;
  /** текущая просрочка, дней (0 — нет) */
  currentOverdueDays: number;
  /** худшая закрытая просрочка за 24 месяца */
  worstClosed24m: OverdueCategory;
  /** были ли кредиты когда-либо */
  hasHistory: boolean;
  director: { hasHistory: boolean; worstClosed24m: OverdueCategory; currentOverdueDays: number };
}

type Profile = Omit<BkiReport, 'inn'>;

const CLEAN_DIRECTOR = { hasHistory: true, worstClosed24m: 'none' as const, currentOverdueDays: 0 };

const KNOWN: Record<string, Profile> = {
  // ООО «Пример» — один небольшой кредит, всё вовремя
  '7704123450': { loans: 1, totalDebt: 1_800_000, monthlyPayments: 95_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7701111110': { loans: 3, totalDebt: 8_200_000, monthlyPayments: 410_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7715234560': { loans: 2, totalDebt: 3_100_000, monthlyPayments: 160_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  // ИП Морозова: своих кредитов не было, у неё как физлица история чистая
  '500312345614': { loans: 0, totalDebt: 0, monthlyPayments: 0, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: false, director: CLEAN_DIRECTOR },
  // ИП Соколова: закрытая просрочка больше 90 дней
  '772834567838': { loans: 2, totalDebt: 2_400_000, monthlyPayments: 140_000, currentOverdueDays: 0, worstClosed24m: 'over_90', hasHistory: true, director: CLEAN_DIRECTOR },
  // ООО «Север»: была короткая просрочка 1–29 дней
  '7810345670': { loans: 2, totalDebt: 3_500_000, monthlyPayments: 300_000, currentOverdueDays: 0, worstClosed24m: '1_29', hasHistory: true, director: CLEAN_DIRECTOR },
  '5027456784': { loans: 1, totalDebt: 2_000_000, monthlyPayments: 90_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7732567898': { loans: 2, totalDebt: 5_000_000, monthlyPayments: 240_000, currentOverdueDays: 64, worstClosed24m: 'over_90', hasHistory: true, director: CLEAN_DIRECTOR },
  '771956789000': { loans: 0, totalDebt: 0, monthlyPayments: 0, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: false, director: { hasHistory: false, worstClosed24m: 'none', currentOverdueDays: 0 } },
  '5008678904': { loans: 2, totalDebt: 4_500_000, monthlyPayments: 230_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '770367890190': { loans: 1, totalDebt: 150_000, monthlyPayments: 15_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '502478901250': { loans: 3, totalDebt: 1_800_000, monthlyPayments: 95_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7726789010': { loans: 1, totalDebt: 1_200_000, monthlyPayments: 70_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7730890126': { loans: 1, totalDebt: 900_000, monthlyPayments: 60_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  '7716901231': { loans: 1, totalDebt: 1_500_000, monthlyPayments: 80_000, currentOverdueDays: 0, worstClosed24m: 'none', hasHistory: true, director: CLEAN_DIRECTOR },
  // ООО «Комета»: текущая просрочка 45 дней — жёсткий стоп H09
  '7725123450': { loans: 2, totalDebt: 3_200_000, monthlyPayments: 190_000, currentOverdueDays: 45, worstClosed24m: '30_90', hasHistory: true, director: CLEAN_DIRECTOR },
};

export function bkiReport(inn: string): BkiReport {
  const known = KNOWN[inn];
  if (known) return { inn, ...known };
  const r = rng(`bki:${inn}`);
  const loans = intBetween(r, 0, 3);
  const totalDebt = loans ? Math.round((between(r, 300_000, 3_000_000) * loans) / 10_000) * 10_000 : 0;
  return {
    inn,
    loans,
    totalDebt,
    monthlyPayments: Math.round(totalDebt / 22 / 1000) * 1000,
    currentOverdueDays: 0,
    worstClosed24m: r() < 0.2 ? '1_29' : 'none',
    hasHistory: loans > 0 || r() < 0.5,
    director: CLEAN_DIRECTOR,
  };
}

export const historyOf = (r: BkiReport): CreditHistory => ({
  company: { hasHistory: r.hasHistory, worstClosed24m: r.worstClosed24m, currentOverdueDays: r.currentOverdueDays },
  director: r.director,
});
