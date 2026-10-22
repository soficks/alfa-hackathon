import { between, intBetween, rng } from './random.ts';

/** Мок бюро кредитных историй: детерминированно по ИНН. */
export interface BkiReport {
  inn: string;
  loans: number;
  totalDebt: number;
  monthlyPayments: number;
  overdueCurrent: boolean;
  overdueClosed12m: number;
}

type BkiProfile = Omit<BkiReport, 'inn'>;

const KNOWN: Record<string, BkiProfile> = {
  // ООО «Пример» — один небольшой кредит, платит вовремя
  '7704123450': { loans: 1, totalDebt: 1_800_000, monthlyPayments: 95_000, overdueCurrent: false, overdueClosed12m: 0 },
  // ООО «АльфаТех» — заметные обязательства
  '7701111110': { loans: 3, totalDebt: 8_200_000, monthlyPayments: 410_000, overdueCurrent: false, overdueClosed12m: 0 },
  '7715234560': { loans: 2, totalDebt: 3_100_000, monthlyPayments: 160_000, overdueCurrent: false, overdueClosed12m: 0 },
  '500312345614': { loans: 0, totalDebt: 0, monthlyPayments: 0, overdueCurrent: false, overdueClosed12m: 0 },
  '772834567838': { loans: 2, totalDebt: 2_400_000, monthlyPayments: 140_000, overdueCurrent: false, overdueClosed12m: 2 },
  '7810345670': { loans: 2, totalDebt: 6_500_000, monthlyPayments: 300_000, overdueCurrent: false, overdueClosed12m: 1 },
  '5027456784': { loans: 1, totalDebt: 2_000_000, monthlyPayments: 90_000, overdueCurrent: false, overdueClosed12m: 0 },
  '7732567898': { loans: 2, totalDebt: 5_000_000, monthlyPayments: 240_000, overdueCurrent: true, overdueClosed12m: 3 },
  '771956789000': { loans: 0, totalDebt: 0, monthlyPayments: 0, overdueCurrent: false, overdueClosed12m: 0 },
  '5008678904': { loans: 2, totalDebt: 4_500_000, monthlyPayments: 230_000, overdueCurrent: false, overdueClosed12m: 1 },
  '770367890190': { loans: 0, totalDebt: 0, monthlyPayments: 0, overdueCurrent: false, overdueClosed12m: 0 },
  '502478901250': { loans: 3, totalDebt: 4_800_000, monthlyPayments: 260_000, overdueCurrent: false, overdueClosed12m: 2 },
  '7726789010': { loans: 1, totalDebt: 1_200_000, monthlyPayments: 70_000, overdueCurrent: false, overdueClosed12m: 0 },
  '7730890126': { loans: 1, totalDebt: 900_000, monthlyPayments: 60_000, overdueCurrent: false, overdueClosed12m: 0 },
  '7716901231': { loans: 1, totalDebt: 1_500_000, monthlyPayments: 80_000, overdueCurrent: false, overdueClosed12m: 0 },
  // ООО «Комета» — текущая просрочка: стоп-фактор
  '7725123450': { loans: 2, totalDebt: 3_200_000, monthlyPayments: 190_000, overdueCurrent: true, overdueClosed12m: 1 },
};

/** Добавить или заменить кредитную историю (профили с бэкенда). */
export function registerBki({ inn, ...profile }: BkiReport) {
  KNOWN[inn] = profile;
}

export function bkiReport(inn: string): BkiReport {
  const known = KNOWN[inn];
  if (known) return { inn, ...known };
  const r = rng(`bki:${inn}`);
  const loans = intBetween(r, 0, 3);
  const totalDebt = loans ? Math.round(between(r, 300_000, 3_000_000) * loans / 10_000) * 10_000 : 0;
  return {
    inn,
    loans,
    totalDebt,
    monthlyPayments: Math.round(totalDebt / 22 / 1000) * 1000,
    overdueCurrent: false,
    overdueClosed12m: r() < 0.2 ? 1 : 0,
  };
}
