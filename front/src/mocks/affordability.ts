import type { Alternative, Financials, Metrics, Terms } from '../domain/types.ts';
import { calculateSchedule } from '../domain/finance.ts';
import { AMOUNT_STEP, type Product } from '../config/products.ts';
import { POLICY } from '../config/policy.ts';

/**
 * Платёжеспособность (docs/TZ_credit_pipeline.md, §8 и §11).
 * Считается только здесь, в мок-слое; экраны получают готовые Metrics.
 */

/** База расчёта: всё, что не зависит от условий нового кредита. */
export interface CashflowBase {
  /** среднемесячная очищенная выручка Rev */
  rev: number;
  /** среднемесячный денежный поток CF */
  cf: number;
  cfStress: number;
  variableShare: number;
  fixed: number;
  /** текущие платежи по кредитам (DS_current) */
  ds: number;
  debt: number;
  cv: number;
  cfWeak: number;
  trend: number | null;
  months: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Условная ставка для долгов без графика (§8: max(задолженность, 0,3×лимит), n = 24) */
const UNKNOWN_DEBT_RATE = 20;

function annuity(amount: number, months: number, annualRate: number) {
  const r = annualRate / 12 / 100;
  return r ? (amount * r) / (1 - (1 + r) ** -months) : amount / months;
}

/**
 * Если клиент поправил выручку за 12 месяцев, масштабируем помесячную выручку из выписки:
 * структура по месяцам сохраняется, CF пересчитывается от новой выручки.
 */
function effectiveRevenue(f: Financials) {
  const sum = f.revenueByMonth.reduce((s, x) => s + x, 0);
  if (!sum || !f.revenue12m || Math.abs(f.revenue12m - sum) / sum < 0.005) return f.revenueByMonth;
  const k = f.revenue12m / sum;
  return f.revenueByMonth.map((x) => x * k);
}

export function cashflowBase(f: Financials): CashflowBase {
  const revM = effectiveRevenue(f);
  const v = f.variableShare;
  const fixed = f.fixedMonthly;
  // CF_m = Rev_m − переменные − постоянные; кредитные платежи не вычитаются
  const cfM = revM.map((x) => x * (1 - v) - fixed);
  const rev = mean(revM);
  const cf = mean(cfM);
  const sigma = Math.sqrt(mean(revM.map((x) => (x - rev) ** 2)));
  // слабый период — минимум средних CF за любые последовательные 3 месяца
  let cfWeak = Infinity;
  for (let i = 0; i + 3 <= cfM.length; i++) cfWeak = Math.min(cfWeak, mean(cfM.slice(i, i + 3)));
  const prev3 = mean(revM.slice(-6, -3));
  const last3 = mean(revM.slice(-3));
  const ds =
    f.existingMonthlyPayments > 0
      ? f.existingMonthlyPayments
      : f.existingDebt > 0
        ? annuity(f.existingDebt, 24, UNKNOWN_DEBT_RATE)
        : 0;
  return {
    rev,
    cf,
    cfStress: (1 - v) * rev * (1 - POLICY.STRESS_S) - fixed,
    variableShare: v,
    fixed,
    ds,
    debt: f.existingDebt,
    cv: rev > 0 ? sigma / rev : 0,
    cfWeak: Number.isFinite(cfWeak) ? cfWeak : cf,
    trend: revM.length >= 6 && prev3 > 0 ? last3 / prev3 : null,
    months: revM.length,
  };
}

/**
 * Платёж по новому кредиту для DSCR. Аннуитет — платёж, дифференцированный — первый (S/n + S·r),
 * с отсрочкой — платёж после отсрочки, «проценты, долг в конце» — регулярный процентный платёж
 * (погашение долга одной суммой в конце оценивает сотрудник — открытый вопрос ТЗ про bullet).
 */
export function newPayment(terms: Terms): number {
  const s = calculateSchedule(terms);
  return terms.paymentType === 'interest_only' ? s.firstPayment : s.maxPayment;
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/** Максимальная сумма, при которой платёж не выше aMax (для любого типа графика). */
function amountForPayment(aMax: number, terms: Omit<Terms, 'amount'>): number {
  if (aMax <= 0) return 0;
  const probe = newPayment({ ...terms, amount: 1_000_000 }) / 1_000_000;
  return probe > 0 ? aMax / probe : Infinity;
}

/**
 * Лимит на сроке n (§11): AutoLimit(n) = round_down(min(S_DSCR, K×выручка за год, максимум продукта,
 * полномочия, S_debt), шаг). Для ручной зоны вместо AUTO_AUTHORITY — полномочия сотрудника.
 */
export function limitFor(base: CashflowBase, product: Product, terms: Omit<Terms, 'amount'>, mode: 'auto' | 'manual'): number {
  const aMax = Math.min(base.cf / POLICY.DSCR_MIN, base.cfStress / POLICY.DSCR_STRESS_MIN) - base.ds;
  if (aMax <= 0) return 0;
  const sDscr = amountForPayment(aMax, terms);
  const sDebt = POLICY.DEBT_CF_OK * 12 * base.cf - base.debt;
  const authority = mode === 'auto' ? POLICY.AUTO_AUTHORITY : POLICY.EMPLOYEE_AUTHORITY;
  const cap = Math.min(sDscr, POLICY.K_REVENUE * base.rev * 12, product.maxAmount, sDebt, authority);
  return Math.max(0, Math.floor(cap / AMOUNT_STEP) * AMOUNT_STEP);
}

export function metricsFromBase(base: CashflowBase, terms: Terms, product: Product, now = new Date()): Metrics {
  const aNew = newPayment(terms);
  const den = base.ds + aNew;
  const seasonal = base.cv > POLICY.CV_SEASONAL;
  const cfNegative = base.cf <= 0;
  return {
    rev: Math.round(base.rev),
    cf: Math.round(base.cf),
    dsCurrent: Math.round(base.ds),
    aNew: Math.round(aNew),
    dscr: ratio(base.cf, den),
    variableShare: base.variableShare,
    fixed: Math.round(base.fixed),
    cfStress: Math.round(base.cfStress),
    dscrStress: ratio(base.cfStress, den),
    cv: base.cv,
    cfWeak: seasonal ? Math.round(base.cfWeak) : undefined,
    dscrWeak: seasonal ? ratio(base.cfWeak, den) : undefined,
    trend: base.trend,
    debtBalance: base.debt,
    // при CF ≤ 0 не делим — фиксируем неустойчивую платёжеспособность
    debtCf: cfNegative ? null : (base.debt + terms.amount) / (12 * base.cf),
    cfNegative,
    pti: base.rev > 0 ? aNew / base.rev : 0,
    autoLimit: limitFor(base, product, terms, 'auto'),
    manualLimit: limitFor(base, product, terms, 'manual'),
    calculatedAt: now.toISOString(),
  };
}

export const computeMetrics = (f: Financials, terms: Terms, product: Product, now = new Date()) =>
  metricsFromBase(cashflowBase(f), terms, product, now);

/** Все финансовые условия авто-одобрения выполняются одновременно. */
export function passesAuto(m: Pick<Metrics, 'dscr' | 'dscrStress' | 'debtCf' | 'cfNegative'>) {
  if (m.cfNegative) return false;
  return (m.dscr === null || m.dscr >= POLICY.DSCR_MIN) && (m.dscrStress === null || m.dscrStress >= POLICY.DSCR_STRESS_MIN) && (m.debtCf ?? Infinity) <= POLICY.DEBT_CF_OK;
}

/** Минимальный вариант продукта: наименьшая сумма на самый долгий срок. */
export function minimalVariant(product: Product, requested: Terms): Terms {
  return {
    ...requested,
    amount: product.minAmount,
    term: product.maxTerm,
    graceMonths: requested.paymentType === 'annuity_grace' ? Math.min(requested.graceMonths ?? 1, product.maxTerm - 1) : undefined,
  };
}

const TERM_GRID = [1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 84, 120];

/**
 * Поиск контрпредложений (§11): перебор сроков сетки продукта, S = min(лимит(n), запрошенная сумма),
 * все условия авто-одобрения должны выполняться. Ранжирование: distance = 1×|ΔS|/S + 0,5×|Δn|/n.
 * Залог и поручитель в MVP не перебираются — это ручные сценарии.
 */
export function findAlternatives(f: Financials, requested: Terms, product: Product, mode: 'auto' | 'manual', now = new Date()): Alternative[] {
  const base = cashflowBase(f);
  const terms = [...new Set([...TERM_GRID.filter((n) => n >= product.minTerm && n <= product.maxTerm), requested.term])].sort((a, b) => a - b);
  const found: Alternative[] = [];
  for (const n of terms) {
    const shape: Omit<Terms, 'amount'> = {
      term: n,
      rate: requested.rate,
      paymentType: requested.paymentType,
      graceMonths: requested.paymentType === 'annuity_grace' ? Math.min(requested.graceMonths ?? 1, n - 1) : undefined,
    };
    const amount = Math.min(limitFor(base, product, shape, mode), requested.amount);
    if (amount < product.minAmount) continue;
    if (amount === requested.amount && n === requested.term) continue;
    const candidate: Terms = { ...shape, amount };
    const m = metricsFromBase(base, candidate, product, now);
    if (!passesAuto(m)) continue;
    found.push({
      terms: candidate,
      dscr: m.dscr,
      dscrStress: m.dscrStress,
      debtCf: m.debtCf,
      payment: m.aNew,
      distance: POLICY.W_SUM * (Math.abs(requested.amount - amount) / requested.amount) + POLICY.W_TERM * (Math.abs(requested.term - n) / requested.term),
    });
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, POLICY.OFFERS_MAX);
}
