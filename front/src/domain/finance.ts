import type { PaymentType, Terms } from './types.ts';

export interface ScheduleRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface LoanSchedule {
  rows: ScheduleRow[];
  firstPayment: number;
  lastPayment: number;
  maxPayment: number;
  /** платёж после отсрочки (annuity_grace) */
  afterGracePayment?: number;
  total: number;
  overpayment: number;
}

export type ScheduleInput = Pick<Terms, 'amount' | 'term' | 'rate' | 'paymentType' | 'graceMonths'>;

const cents = (n: number) => Math.round(n * 100) / 100;

function annuityPayment(principal: number, months: number, monthlyRate: number) {
  return cents(monthlyRate ? (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months) : principal / months);
}

/**
 * График платежей. Месячная ставка = годовая / 12 / 100, без комиссий.
 * Округление до копеек на каждой строке, последний платёж закрывает остаток.
 */
export function calculateSchedule({ amount, term, rate, paymentType, graceMonths = 0 }: ScheduleInput): LoanSchedule {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма кредита должна быть больше нуля');
  if (!Number.isInteger(term) || term <= 0) throw new Error('Срок — целое число месяцев больше нуля');
  if (!Number.isFinite(rate) || rate < 0) throw new Error('Ставка не может быть отрицательной');
  const grace = paymentType === 'annuity_grace' ? graceMonths : 0;
  if (!Number.isInteger(grace) || grace < 0 || grace >= term) throw new Error('Отсрочка должна быть меньше срока кредита');

  const r = rate / 12 / 100;
  const rows: ScheduleRow[] = [];
  let balance = amount;
  const annuity = paymentType === 'annuity' ? annuityPayment(amount, term, r) : 0;
  const graceAnnuity = paymentType === 'annuity_grace' ? annuityPayment(amount, term - grace, r) : 0;
  const diffPrincipal = cents(amount / term);

  for (let m = 1; m <= term; m++) {
    const interest = cents(balance * r);
    const last = m === term;
    let principal: number;
    switch (paymentType) {
      case 'annuity':
        principal = last ? balance : Math.min(balance, cents(annuity - interest));
        break;
      case 'differentiated':
        principal = last ? balance : Math.min(balance, diffPrincipal);
        break;
      case 'interest_only':
        principal = last ? balance : 0;
        break;
      case 'annuity_grace':
        principal = m <= grace ? 0 : last ? balance : Math.min(balance, cents(graceAnnuity - interest));
        break;
    }
    principal = cents(principal);
    balance = Math.max(0, cents(balance - principal));
    rows.push({ month: m, payment: cents(principal + interest), principal, interest, balance });
  }

  const payments = rows.map((r) => r.payment);
  const total = cents(payments.reduce((s, p) => s + p, 0));
  return {
    rows,
    firstPayment: payments[0],
    lastPayment: payments[payments.length - 1],
    maxPayment: Math.max(...payments),
    afterGracePayment: paymentType === 'annuity_grace' && grace > 0 ? rows[grace].payment : undefined,
    total,
    overpayment: cents(total - amount),
  };
}

/** Платёж, который используем для оценки нагрузки: максимальный по графику. */
export const loadPayment = (terms: ScheduleInput) => calculateSchedule(terms).maxPayment;

export interface PaymentSummaryItem {
  label: string;
  value: number;
}

/** Что показывать крупно в зависимости от типа платежа. */
export function paymentSummary(terms: ScheduleInput, schedule = calculateSchedule(terms)): PaymentSummaryItem[] {
  switch (terms.paymentType) {
    case 'annuity':
      return [{ label: 'Ежемесячный платёж', value: schedule.firstPayment }];
    case 'differentiated':
      return [
        { label: 'Первый платёж', value: schedule.firstPayment },
        { label: 'Последний платёж', value: schedule.lastPayment },
      ];
    case 'interest_only':
      return [
        { label: 'Ежемесячно (проценты)', value: schedule.firstPayment },
        { label: 'Последний платёж', value: schedule.lastPayment },
      ];
    case 'annuity_grace':
      return schedule.afterGracePayment === undefined
        ? [{ label: 'Ежемесячный платёж', value: schedule.firstPayment }]
        : [
            { label: 'Платёж в отсрочку', value: schedule.firstPayment },
            { label: 'Платёж после', value: schedule.afterGracePayment },
          ];
  }
}

/** Максимальная сумма (кратная шагу), при которой максимальный платёж не превышает лимит. */
export function maxAmountForPayment(limit: number, terms: Omit<ScheduleInput, 'amount'>, step: number) {
  const perUnit = loadPayment({ ...terms, amount: 1_000_000 }) / 1_000_000;
  if (perUnit <= 0) return Infinity;
  return Math.floor(limit / perUnit / step) * step;
}

/** Минимальный срок в пределах [from, to], при котором платёж укладывается в лимит. */
export function minTermForPayment(limit: number, terms: Omit<ScheduleInput, 'term'>, from: number, to: number) {
  for (let term = from; term <= to; term++) {
    const grace = terms.paymentType === 'annuity_grace' ? Math.min(terms.graceMonths ?? 0, term - 1) : 0;
    if (loadPayment({ ...terms, term, graceMonths: grace }) <= limit) return term;
  }
  return null;
}

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  annuity: 'Аннуитетный',
  differentiated: 'Дифференцированный',
  interest_only: 'Проценты ежемесячно, долг в конце',
  annuity_grace: 'С отсрочкой',
};

export const PAYMENT_TYPE_HINT: Record<PaymentType, string> = {
  annuity: 'Одинаковый платёж каждый месяц — удобно планировать.',
  differentiated: 'Долг гасится равными частями: первые платежи выше, общая переплата меньше.',
  interest_only: 'Подходит, если деньги вернутся одной суммой: оплата от покупателя, исполненный контракт.',
  annuity_grace: 'Первые 1–3 месяца платите только проценты, пока оборудование или новая точка начинают приносить доход.',
};

export const SCHEDULE_NOTE: Record<PaymentType, string> = {
  annuity: 'Аннуитет: платёж одинаковый, последний скорректирован до полного погашения.',
  differentiated: 'Дифференцированный: основной долг равными частями, проценты начисляются на остаток.',
  interest_only: 'Ежемесячно — только проценты, весь основной долг гасится последним платежом.',
  annuity_grace: 'В период отсрочки — только проценты, затем аннуитет на оставшийся срок.',
};
