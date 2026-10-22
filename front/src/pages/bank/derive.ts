import { productById } from '../../config/products';
import { paymentSummary } from '../../domain/finance';
import type { Application, DocType } from '../../domain/types';

export const missingDocTypes = (app: Application): DocType[] =>
  productById(app.productId).requiredDocs.filter((t) => !app.documents.some((d) => d.docType === t));

export const termsOf = (app: Application) => app.decision?.terms ?? app.requested;

export const mainPayment = (app: Application) => paymentSummary(termsOf(app))[0];

/** Когда проверка завершена: решение или отзыв клиентом */
export function finishedAt(app: Application) {
  if (app.decision) return app.decision.decidedAt;
  return [...app.history].reverse().find((e) => e.type === 'withdrawn')?.at ?? app.updatedAt;
}

export type DecisionKind = 'approve' | 'counter_offer' | 'reject' | 'withdrawn';

export const decisionKind = (app: Application): DecisionKind => (app.decision ? app.decision.type : 'withdrawn');

export const DECISION_LABEL: Record<DecisionKind, string> = {
  approve: 'Одобрено',
  counter_offer: 'Встречное предложение',
  reject: 'Отказано',
  withdrawn: 'Отозвана клиентом',
};

/** Что стало с заявкой после решения */
export function afterDecision(app: Application): string {
  switch (app.status) {
    case 'ISSUED':
      return 'Выдан';
    case 'SIGNING':
      return app.signedAt ? 'Подписано, ждём выбора счёта' : 'Ждём подписания';
    case 'APPROVED':
    case 'COUNTER_OFFER':
      return 'Ждём ответа клиента';
    case 'DECLINED_BY_CLIENT':
      return 'Клиент отказался';
    case 'REJECTED':
      return 'Отказ отправлен клиенту';
    case 'WITHDRAWN':
      return 'Отозвана';
    default:
      return '';
  }
}

/** События, из которых строится «Ход проверки» */
export const COURSE_EVENTS = [
  'submitted',
  'auto_result',
  'decision',
  'taken',
  'docs_requested',
  'client_docs',
  'client_answered',
  'client_changed',
  'client_accepted',
  'client_declined',
  'signed',
  'issued',
  'withdrawn',
];
