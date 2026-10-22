import { between, rng } from './random.ts';

/** Мок анализа выписки по расчётному счёту: поступления по месяцам за 12 месяцев. */
export interface StatementAnalysis {
  inn: string;
  /** поступления по месяцам, от старых к новым */
  turnoverByMonth: number[];
  revenue12m: number;
  avgTurnover12m: number;
  avgTurnover3m: number;
}

interface Profile {
  /** средний оборот в месяц за первые 9 месяцев */
  base: number;
  /** средний оборот за 3 мес / средний за 12 мес − 1 */
  change3m: number;
}

const KNOWN: Record<string, Profile> = {
  '7704123450': { base: 3_000_000, change3m: 0.12 }, // Пример — растёт
  '7701111110': { base: 3_800_000, change3m: -0.28 }, // АльфаТех — обороты падают
  '7715234560': { base: 2_600_000, change3m: 0.04 },
  '500312345614': { base: 2_200_000, change3m: 0.15 },
  '772834567838': { base: 600_000, change3m: -0.12 },
  '7810345670': { base: 1_100_000, change3m: -0.05 },
  '5027456784': { base: 4_200_000, change3m: 0.1 },
  '7732567898': { base: 1_500_000, change3m: -0.3 },
  '771956789000': { base: 250_000, change3m: 0.2 },
  '5008678904': { base: 1_900_000, change3m: -0.15 },
  '770367890190': { base: 300_000, change3m: 0.05 },
  '502478901250': { base: 500_000, change3m: -0.2 },
  '7726789010': { base: 1_300_000, change3m: 0.06 },
  '7730890126': { base: 1_600_000, change3m: 0 },
  '7716901231': { base: 2_000_000, change3m: 0.02 },
  '7725123450': { base: 1_400_000, change3m: -0.05 },
};

const round1000 = (n: number) => Math.round(n / 1000) * 1000;

export function analyzeStatement(inn: string): StatementAnalysis {
  const r = rng(`statement:${inn}`);
  const profile = KNOWN[inn] ?? { base: Math.round(between(r, 400_000, 4_000_000)), change3m: between(r, -0.15, 0.15) };
  const first9 = Array.from({ length: 9 }, () => round1000(profile.base * (1 + between(r, -0.06, 0.06))));
  const sum9 = first9.reduce((s, x) => s + x, 0);
  // средний за 3 мес = k · средний за 12 мес, где средний за 12 включает эти же 3 месяца
  const k = 1 + profile.change3m;
  const avg3Target = (k * sum9) / (12 - 3 * k);
  const weights = [1 + between(r, -0.03, 0.03), 1 + between(r, -0.03, 0.03)];
  const m10 = round1000(avg3Target * weights[0]);
  const m11 = round1000(avg3Target * weights[1]);
  const m12 = round1000(avg3Target * 3 - m10 - m11);
  const turnoverByMonth = [...first9, m10, m11, m12];
  const revenue12m = turnoverByMonth.reduce((s, x) => s + x, 0);
  return {
    inn,
    turnoverByMonth,
    revenue12m,
    avgTurnover12m: Math.round(revenue12m / 12),
    avgTurnover3m: Math.round((m10 + m11 + m12) / 3),
  };
}
