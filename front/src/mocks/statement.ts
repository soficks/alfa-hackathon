import { between, rng } from './random.ts';

/**
 * Мок анализа выписки по расчётному счёту за 12 месяцев (§8 ТЗ).
 * Содержимое файла не читается: данные генерируются детерминированно по ИНН.
 *
 * Rev_m — очищенная выручка (поступления без внутренних переводов, займов и транзита);
 * расходы делятся на переменные (доля v от выручки) и постоянные (Fixed в месяц);
 * CF_m = Rev_m − переменные − постоянные. Кредитные платежи из CF не вычитаются.
 */
export interface StatementAnalysis {
  inn: string;
  /** все поступления по месяцам, от старых к новым */
  turnoverByMonth: number[];
  /** очищенная выручка Rev_m */
  revenueByMonth: number[];
  /** денежный поток CF_m */
  cashflowByMonth: number[];
  expenses: { suppliers: number; payroll: number; taxes: number; rent: number; other: number };
  variableShare: number;
  fixedMonthly: number;
  topBuyerShare: number;
  cashShare: number;
  revenue12m: number;
  avgTurnover12m: number;
  avgTurnover3m: number;
}

interface Profile {
  /** средняя выручка в месяц в первые 9 месяцев */
  base: number;
  /** выручка последних 3 мес. / предыдущих 3 мес. */
  trend: number;
  /** доля переменных расходов v */
  v: number;
  /** постоянные расходы в месяц */
  fixed: number;
  /** амплитуда сезонности: 0 — ровные обороты */
  season?: number;
  topBuyer?: number;
  cash?: number;
}

/** Профили демо-компаний подобраны так, чтобы покрыть группы A–E и все зоны DSCR. */
const KNOWN: Record<string, Profile> = {
  // ООО «Пример»: пример из ТЗ — тренд 1,08; CF ≈ 500 тыс.
  '7704123450': { base: 3_000_000, trend: 1.08, v: 0.6, fixed: 700_000, topBuyer: 0.24, cash: 0.04 },
  // ООО «АльфаТех»: обороты падают — тренд 0,72
  '7701111110': { base: 3_800_000, trend: 0.72, v: 0.45, fixed: 1_000_000, topBuyer: 0.38, cash: 0.02 },
  '7715234560': { base: 2_600_000, trend: 1.04, v: 0.5, fixed: 600_000, topBuyer: 0.3, cash: 0.03 },
  '500312345614': { base: 2_200_000, trend: 1.12, v: 0.6, fixed: 400_000, topBuyer: 0.12, cash: 0.08 },
  '772834567838': { base: 600_000, trend: 0.88, v: 0.55, fixed: 150_000, topBuyer: 0.1, cash: 0.35 },
  '7810345670': { base: 1_100_000, trend: 0.95, v: 0.5, fixed: 150_000, topBuyer: 0.55, cash: 0.02 },
  '5027456784': { base: 4_200_000, trend: 1.12, v: 0.55, fixed: 900_000, topBuyer: 0.33, cash: 0.03 },
  '7732567898': { base: 1_500_000, trend: 0.65, v: 0.6, fixed: 400_000 },
  '771956789000': { base: 250_000, trend: 1.2, v: 0.4, fixed: 60_000, cash: 0.4 },
  // ООО «Гранит»: DSCR в пограничной зоне 1,1–1,25
  '5008678904': { base: 1_900_000, trend: 0.92, v: 0.45, fixed: 450_000, topBuyer: 0.42, cash: 0.02 },
  '770367890190': { base: 300_000, trend: 1.12, v: 0.4, fixed: 80_000, topBuyer: 0.2, cash: 0.1 },
  '502478901250': { base: 500_000, trend: 0.95, v: 0.55, fixed: 120_000, cash: 0.25 },
  '7726789010': { base: 1_300_000, trend: 1.05, v: 0.45, fixed: 300_000, topBuyer: 0.28, cash: 0.02 },
  // ООО «Ромашка»: сезонная выпечка — CV > 0,3
  '7730890126': { base: 1_600_000, trend: 1.02, v: 0.55, fixed: 300_000, season: 0.55, topBuyer: 0.2, cash: 0.12 },
  '7716901231': { base: 2_000_000, trend: 1.12, v: 0.5, fixed: 400_000, topBuyer: 0.25, cash: 0.02 },
  '7725123450': { base: 1_400_000, trend: 0.97, v: 0.6, fixed: 300_000, cash: 0.15 },
};

const round1000 = (n: number) => Math.round(n / 1000) * 1000;
/** Доля «не выручки» в поступлениях: внутренние переводы, займы учредителей, возвраты */
const NON_REVENUE_SHARE = 0.06;

export function analyzeStatement(inn: string): StatementAnalysis {
  const r = rng(`statement:${inn}`);
  const p: Profile = KNOWN[inn] ?? {
    base: Math.round(between(r, 400_000, 4_000_000)),
    trend: between(r, 0.9, 1.15),
    v: between(r, 0.45, 0.65),
    fixed: 0,
  };
  const fixed = p.fixed || Math.round(p.base * between(r, 0.12, 0.2));

  // Первые 9 месяцев — база с шумом и сезонностью
  const seasonal = (i: number) => 1 + (p.season ?? 0) * Math.sin((i / 12) * Math.PI * 2);
  const first9 = Array.from({ length: 9 }, (_, i) => round1000(p.base * seasonal(i) * (1 + between(r, -0.04, 0.04))));
  // Последние 3 месяца — ровно trend × предыдущие 3
  const prev3 = first9.slice(6);
  const last3 = prev3.map((x) => round1000(x * p.trend));
  const revenueByMonth = [...first9, ...last3];

  const cashflowByMonth = revenueByMonth.map((rev) => Math.round(rev * (1 - p.v) - fixed));
  const totalRev = revenueByMonth.reduce((s, x) => s + x, 0);
  const variable = totalRev * p.v;
  const turnoverByMonth = revenueByMonth.map((x) => round1000(x / (1 - NON_REVENUE_SHARE)));
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

  return {
    inn,
    turnoverByMonth,
    revenueByMonth,
    cashflowByMonth,
    expenses: {
      suppliers: Math.round(variable * 0.85),
      other: Math.round(variable * 0.15 + fixed * 12 * 0.1),
      payroll: Math.round(fixed * 12 * 0.55),
      taxes: Math.round(fixed * 12 * 0.15),
      rent: Math.round(fixed * 12 * 0.2),
    },
    variableShare: p.v,
    fixedMonthly: fixed,
    topBuyerShare: p.topBuyer ?? 0.2,
    cashShare: p.cash ?? 0.05,
    revenue12m: totalRev,
    avgTurnover12m: Math.round(sum(turnoverByMonth) / 12),
    avgTurnover3m: Math.round(sum(turnoverByMonth.slice(9)) / 3),
  };
}
