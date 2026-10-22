import type { Company, Financials, Scoring, ScoringFactor, ScoreZone, StopFactor, Terms } from '../domain/types.ts';
import { calculateSchedule } from '../domain/finance.ts';
import { monthsBetween } from '../domain/time.ts';
import { STOP_BUSINESS_AGE_MONTHS } from '../config/products.ts';
import { businessAge, percent, rub } from '../utils/format.ts';

/**
 * Балльная модель: 0–1000, чем выше балл, тем ниже риск. База 500.
 * Скоринг только оценивает риск — решение принимает кредитная логика (creditPolicy.ts).
 */
export const BASE_SCORE = 500;

export interface ScoringInput {
  company: Company;
  financials: Financials;
  terms: Terms;
  now?: Date;
}

export const zoneOf = (score: number): ScoreZone => (score < 400 ? 'high_risk' : score < 700 ? 'manual' : 'auto');

const share = (x: number) => percent(x, 0);

function ageFactor(months: number): ScoringFactor {
  const points = months < 12 ? -80 : months <= 36 ? 0 : 60;
  return {
    id: 'age',
    title: 'Срок работы бизнеса',
    value: businessAge(months),
    points,
    explanation:
      months < 12
        ? `Бизнес работает ${businessAge(months)} — меньше года, история оборотов короткая.`
        : months <= 36
          ? `Бизнес работает ${businessAge(months)} — нейтральный срок.`
          : `Бизнес работает ${businessAge(months)} — устойчивая история.`,
  };
}

function paymentFactor(payment: number, avg3: number): ScoringFactor {
  const ratio = avg3 > 0 ? payment / avg3 : Infinity;
  const points = ratio <= 0.2 ? 120 : ratio <= 0.35 ? 40 : ratio <= 0.5 ? -60 : -150;
  return {
    id: 'payment_to_turnover',
    title: 'Платёж / средний оборот за 3 мес',
    value: Number.isFinite(ratio) ? share(ratio) : 'нет оборотов',
    points,
    explanation: Number.isFinite(ratio)
      ? `Новый платёж ${rub(payment)} составит ${share(ratio)} среднемесячного оборота за последние 3 месяца.`
      : 'За последние 3 месяца нет поступлений на счёт.',
  };
}

function debtLoadFactor(existingDebt: number, amount: number, revenue: number): ScoringFactor {
  const ratio = revenue > 0 ? (existingDebt + amount) / revenue : Infinity;
  const points = ratio <= 0.3 ? 100 : ratio <= 0.6 ? 0 : ratio <= 1 ? -100 : -200;
  return {
    id: 'debt_load',
    title: 'Долговая нагрузка',
    value: Number.isFinite(ratio) ? share(ratio) : '—',
    points,
    explanation: `Действующие кредиты (${rub(existingDebt)}) и новый (${rub(amount)}) вместе составят ${
      Number.isFinite(ratio) ? share(ratio) : 'неизвестную долю'
    } годовой выручки.`,
  };
}

function historyFactor(f: Financials): ScoringFactor {
  if (f.overdueClosed12m > 0) {
    const points = Math.max(-160, -80 * f.overdueClosed12m);
    return {
      id: 'credit_history',
      title: 'Кредитная история',
      value: `закрытых просрочек: ${f.overdueClosed12m}`,
      points,
      explanation: `За последние 12 месяцев были просрочки (${f.overdueClosed12m}), сейчас они закрыты.`,
    };
  }
  const hasLoans = f.existingLoans > 0 || f.existingDebt > 0;
  return {
    id: 'credit_history',
    title: 'Кредитная история',
    value: hasLoans ? 'без просрочек' : 'нет кредитов',
    points: hasLoans ? 80 : 0,
    explanation: hasLoans ? 'Кредиты обслуживаются без просрочек.' : 'Кредитов не было — оценить платёжную дисциплину нельзя.',
  };
}

function dynamicsFactor(avg3: number, avg12: number): ScoringFactor {
  const change = avg12 > 0 ? avg3 / avg12 - 1 : 0;
  const points = change >= 0.1 ? 50 : change >= -0.1 ? 0 : change >= -0.25 ? -60 : -120;
  const signed = `${change > 0 ? '+' : ''}${share(change)}`;
  return {
    id: 'turnover_dynamics',
    title: 'Динамика оборотов',
    value: signed,
    points,
    explanation:
      change >= 0.1
        ? `Обороты за последние 3 месяца выросли на ${share(change)} к среднему за год.`
        : change >= -0.1
          ? 'Обороты за последние 3 месяца на уровне среднего за год.'
          : `Обороты за последние 3 месяца снизились на ${share(-change)} к среднему за год.`,
  };
}

function amountFactor(amount: number, revenue: number): ScoringFactor {
  const ratio = revenue > 0 ? amount / revenue : Infinity;
  const points = ratio <= 0.25 ? 50 : ratio <= 0.5 ? 0 : -80;
  return {
    id: 'amount_to_revenue',
    title: 'Сумма кредита / выручка за 12 мес',
    value: Number.isFinite(ratio) ? share(ratio) : '—',
    points,
    explanation: `Запрошенная сумма — ${Number.isFinite(ratio) ? share(ratio) : 'неизвестная доля'} годовой выручки.`,
  };
}

export function stopFactors(company: Company, f: Financials, now: Date): StopFactor[] {
  const list: StopFactor[] = [];
  if (company.status === 'liquidated') list.push({ code: 'company_liquidated', text: 'Компания ликвидирована по данным ЕГРЮЛ' });
  if (f.overdueCurrent) list.push({ code: 'overdue_current', text: 'Текущая просрочка по данным БКИ' });
  if (monthsBetween(new Date(company.registeredAt), now) < STOP_BUSINESS_AGE_MONTHS) {
    list.push({ code: 'business_too_young', text: `Бизнесу меньше ${STOP_BUSINESS_AGE_MONTHS} месяцев` });
  }
  return list;
}

export function score({ company, financials: f, terms, now = new Date() }: ScoringInput): Scoring {
  const payment = calculateSchedule(terms).maxPayment;
  const factors = [
    ageFactor(monthsBetween(new Date(company.registeredAt), now)),
    paymentFactor(payment, f.avgTurnover3m),
    debtLoadFactor(f.existingDebt, terms.amount, f.revenue12m),
    historyFactor(f),
    dynamicsFactor(f.avgTurnover3m, f.avgTurnover12m),
    amountFactor(terms.amount, f.revenue12m),
  ];
  const total = Math.min(1000, Math.max(0, BASE_SCORE + factors.reduce((s, x) => s + x.points, 0)));
  return {
    score: total,
    base: BASE_SCORE,
    zone: zoneOf(total),
    factors,
    stopFactors: stopFactors(company, f, now),
    calculatedAt: now.toISOString(),
  };
}

/** 1–3 фактора с наибольшим отрицательным вкладом — для блока «Почему нужна ручная проверка». */
export const worstFactors = (s: Scoring, n = 3) =>
  [...s.factors].filter((x) => x.points < 0).sort((a, b) => a.points - b.points).slice(0, n);
