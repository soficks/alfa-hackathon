import type { Company, CreditHistory, ExternalSources, Grade, Scoring, ScoringFactor } from '../domain/types.ts';
import { monthsBetween } from '../domain/time.ts';
import { POLICY } from '../config/policy.ts';
import { businessAge } from '../utils/format.ts';

/**
 * Экспертная скоринговая карта (docs/TZ_credit_pipeline.md, §9) и калибровка балла в PD (§10).
 * S = сумма пяти табличных вкладов, диапазон 300–660. Базовых баллов нет.
 * Веса — экспертные, а не оценённые регрессией; PD — демонстрационная калибровка.
 */

export const PD_FACTOR = POLICY.PDO / Math.LN2; // 28,853901
export const PD_OFFSET = POLICY.SCORE0 - PD_FACTOR * Math.log(POLICY.ODDS0); // 487,122876

/** Шансы возврата к дефолту: odds = exp((S − offset) / factor) */
export const oddsOf = (score: number) => Math.exp((score - PD_OFFSET) / PD_FACTOR);
/** PD = 1 / (1 + odds) */
export const pdOf = (score: number) => 1 / (1 + oddsOf(score));

/** Группа риска: A ≥ 640, B 610–639, C 580–609, D 550–579, E < 550 */
export function gradeOf(score: number): Grade {
  const g = POLICY.GRADE;
  if (score >= g.A) return 'A';
  if (score >= g.B) return 'B';
  if (score >= g.C) return 'C';
  if (score >= g.D) return 'D';
  return 'E';
}

export const SCORE_MIN = 300;
export const SCORE_MAX = 660;

/* ---------- Пять характеристик карты; интервалы не пересекаются ---------- */

export function agePoints(months: number): [string, number] {
  if (months < 12) return ['меньше 12 мес.', 60];
  if (months < 24) return ['12–24 мес.', 90];
  if (months < 36) return ['24–36 мес.', 105];
  if (months < 60) return ['36–60 мес.', 120];
  return ['60 мес. и больше', 135];
}

/** Худшая действующая категория по компании и руководителю (консервативно). */
export function historyPoints(h: CreditHistory): [string, number] {
  const cats = [h.company.worstClosed24m, h.director.worstClosed24m];
  if (cats.includes('over_90')) return ['закрытые просрочки > 90 дней за 24 мес.', 60];
  if (cats.includes('30_90')) return ['закрытые просрочки 30–90 дней', 100];
  if (cats.includes('1_29')) return ['закрытые просрочки 1–29 дней', 135];
  if (!h.company.hasHistory && !h.director.hasHistory) return ['нет кредитной истории', 120];
  return ['без просрочек', 160];
}

/** Тренд = выручка последних 3 мес. / предыдущих 3 мес. Нет данных — худшая категория. */
export function trendPoints(trend: number | null): [string, number] {
  if (trend === null || trend < 0.7) return ['меньше 0,7', 50];
  if (trend < 0.9) return ['0,7–0,9', 80];
  if (trend < 1.0) return ['0,9–1,0', 100];
  if (trend < 1.1) return ['1,0–1,1', 110];
  return ['1,1 и больше', 125];
}

/** Долг выше порога S06 — налоги и ФССП больше 10% месячного CF. */
export function taxDebtAboveS06(s: ExternalSources, cf: number) {
  const debt = s.taxDebt + s.fsspDebt;
  return debt > 0 && debt > POLICY.S06_TAX_DEBT_TO_CF * Math.max(cf, 0);
}

export function taxPoints(s: ExternalSources, cf: number): [string, number] {
  if (taxDebtAboveS06(s, cf)) return ['долг выше порога S06', 60];
  if (s.taxDiscipline === 'minor' || s.taxDebt + s.fsspDebt > 0) return ['разовые задержки / небольшой долг', 100];
  return ['платежи регулярно, долгов нет', 130];
}

/** Разделы ОКВЭД: B2B-услуги — транспорт, IT, консалтинг, наука, реклама, дизайн, аренда, поддержка бизнеса. */
const B2B_SECTIONS = [49, 52, 62, 63, 69, 70, 71, 72, 73, 74, 77, 78, 80, 81, 82];

export function industryPoints(okved: string): [string, number] {
  const top = Number(okved.split('.')[0]);
  if (top === 56 || (top >= 41 && top <= 43)) return ['общепит / строительство', 70];
  if (top >= 45 && top <= 47) return ['торговля', 92];
  if ((top >= 10 && top <= 33) || B2B_SECTIONS.includes(top)) return ['производство / B2B-услуги', 110];
  // В карте ТЗ только три категории. Прочие отрасли — как торговля (предложение, не утверждено).
  return ['прочие отрасли (как торговля)', 92];
}

const fmt2 = (x: number) => x.toFixed(2).replace('.', ',');

export interface ScoringInput {
  company: Company;
  sources: ExternalSources;
  history: CreditHistory;
  trend: number | null;
  cf: number;
  now?: Date;
}

export function score({ company, sources, history, trend, cf, now = new Date() }: ScoringInput): Scoring {
  const age = monthsBetween(new Date(company.registeredAt), now);
  const rows: [ScoringFactor['code'], string, string, [string, number], number][] = [
    ['age', 'Срок деятельности', businessAge(age), agePoints(age), 135],
    ['history', 'Кредитная история: компания + руководитель', historyPoints(history)[0], historyPoints(history), 160],
    ['trend', 'Тренд выручки', trend === null ? 'нет данных' : `тренд ${fmt2(trend)}`, trendPoints(trend), 125],
    ['tax', 'Налоговая дисциплина', taxPoints(sources, cf)[0], taxPoints(sources, cf), 130],
    ['industry', 'Отрасль по ОКВЭД', `${company.okved} — ${company.okvedName}`, industryPoints(company.okved), 110],
  ];
  const factors: ScoringFactor[] = rows.map(([code, title, value, [category, points], maxPoints]) => ({ code, title, value, category, points, maxPoints }));
  const total = factors.reduce((s, f) => s + f.points, 0);
  return {
    score: total,
    odds: oddsOf(total),
    pd: pdOf(total),
    grade: gradeOf(total),
    factors,
    calculatedAt: now.toISOString(),
    policyVersion: POLICY.version,
  };
}
