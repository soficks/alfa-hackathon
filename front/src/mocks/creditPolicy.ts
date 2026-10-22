import type { DocFile, DocType, Financials, Recommendation, Scoring, Terms } from '../domain/types.ts';
import { maxAmountForPayment } from '../domain/finance.ts';
import { AMOUNT_STEP, type Product } from '../config/products.ts';
import { DOC_TYPES } from '../config/docTypes.ts';
import { rejectReason } from '../config/rejectReasons.ts';
import { rub } from '../utils/format.ts';

/**
 * Кредитная логика поверх скоринга: что делать с заявкой с учётом продукта, суммы и правил банка.
 */
export const COUNTER_PAYMENT_SHARE = 0.35;

export interface PolicyInput {
  product: Product;
  requested: Terms;
  scoring: Scoring;
  documents: DocFile[];
  financials: Financials;
}

export type PolicyOutcome =
  | { outcome: 'REJECTED'; reasonCode: string; terms?: undefined; recommendation: Recommendation }
  | { outcome: 'APPROVED'; terms: Terms; reasonCode?: undefined; recommendation: Recommendation }
  | { outcome: 'IN_QUEUE'; terms?: undefined; reasonCode?: undefined; recommendation: Recommendation };

export const missingDocs = (product: Product, documents: DocFile[]): DocType[] =>
  product.requiredDocs.filter((t) => !documents.some((d) => d.docType === t));

/** Ставка решения: базовая ставка продукта, при балле ≥ 800 — на 1 п.п. ниже. */
export const rateFor = (product: Product, score: number) => (score >= 800 ? product.baseRate - 1 : product.baseRate);

/**
 * Сумма встречного предложения: максимальная, при которой платёж ≤ 35% среднего оборота за 3 мес,
 * с округлением вниз до шага и не ниже минимума продукта. null — если даже минимум не проходит.
 */
export function counterAmount(product: Product, requested: Terms, avgTurnover3m: number): number | null {
  const max = maxAmountForPayment(avgTurnover3m * COUNTER_PAYMENT_SHARE, requested, AMOUNT_STEP);
  const amount = Math.min(requested.amount, max);
  return amount < product.minAmount ? null : amount;
}

export function manualReasons(input: PolicyInput): string[] {
  const reasons: string[] = [];
  const { scoring, product, requested } = input;
  if (scoring.zone === 'manual') reasons.push('Балл в зоне ручной проверки');
  if (scoring.zone === 'high_risk') reasons.push('Балл в зоне высокого риска');
  if (requested.amount > product.autoLimit) reasons.push(`Сумма выше авто-лимита ${rub(product.autoLimit)}`);
  const missing = missingDocs(product, input.documents);
  if (missing.length) reasons.push(`Не хватает документов: ${missing.map((t) => DOC_TYPES[t].short.toLowerCase()).join(', ')}`);
  return reasons;
}

/** Рекомендация системы для специалиста — решение всё равно принимает человек. */
export function recommend(input: PolicyInput): Recommendation {
  const { scoring, product, requested, financials } = input;
  const reasons = manualReasons(input);
  if (scoring.stopFactors.length) {
    return { type: 'reject', text: `Рекомендуем отказ: ${scoring.stopFactors[0].text.toLowerCase()}`, manualReasons: reasons };
  }
  if (scoring.zone === 'high_risk') {
    return { type: 'reject', text: 'Рекомендуем отказ: высокий риск по скорингу', manualReasons: reasons };
  }
  const counter = counterAmount(product, requested, financials.avgTurnover3m);
  if (counter === null) {
    return { type: 'reject', text: 'Рекомендуем отказ: даже минимальная сумма продукта слишком нагружает обороты', manualReasons: reasons };
  }
  if (counter < requested.amount) {
    return {
      type: 'counter_offer',
      text: `Рекомендуем встречное предложение: до ${rub(counter)}`,
      amount: counter,
      manualReasons: reasons,
    };
  }
  return { type: 'approve', text: 'Рекомендуем одобрить на запрошенных условиях', manualReasons: reasons };
}

export function decide(input: PolicyInput): PolicyOutcome {
  const { scoring, product, requested, documents } = input;
  const recommendation = recommend(input);
  if (scoring.stopFactors.length) {
    return { outcome: 'REJECTED', reasonCode: rejectReason(scoring.stopFactors[0].code).code, recommendation };
  }
  const canAuto = scoring.score >= 700 && requested.amount <= product.autoLimit && missingDocs(product, documents).length === 0;
  if (canAuto) {
    return { outcome: 'APPROVED', terms: { ...requested, rate: rateFor(product, scoring.score) }, recommendation };
  }
  return { outcome: 'IN_QUEUE', recommendation };
}
