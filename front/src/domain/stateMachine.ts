import type { AppStatus } from './types.ts';

/**
 * Переходы заявки. DRAFT не отзывается — черновик удаляется.
 * Любое изменение статуса проходит через assertTransition.
 */
export const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['AUTO_CHECKS'],
  AUTO_CHECKS: ['APPROVED', 'REJECTED', 'IN_QUEUE'],
  IN_QUEUE: ['IN_REVIEW', 'AUTO_CHECKS', 'WITHDRAWN'],
  IN_REVIEW: ['NEED_INFO', 'APPROVED', 'COUNTER_OFFER', 'REJECTED', 'WITHDRAWN'],
  NEED_INFO: ['IN_REVIEW', 'WITHDRAWN'],
  APPROVED: ['SIGNING'],
  COUNTER_OFFER: ['SIGNING', 'DECLINED_BY_CLIENT'],
  SIGNING: ['ISSUED'],
  ISSUED: [],
  REJECTED: [],
  DECLINED_BY_CLIENT: [],
  WITHDRAWN: [],
};

export class TransitionError extends Error {
  readonly from: AppStatus;
  readonly to: AppStatus;
  constructor(from: AppStatus, to: AppStatus) {
    super(`Недопустимый переход заявки: ${from} → ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

export const canTransition = (from: AppStatus, to: AppStatus) => TRANSITIONS[from].includes(to);

export function assertTransition(from: AppStatus, to: AppStatus) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export const FINAL_STATUSES: AppStatus[] = ['ISSUED', 'REJECTED', 'DECLINED_BY_CLIENT', 'WITHDRAWN'];
export const isFinal = (s: AppStatus) => FINAL_STATUSES.includes(s);

/** Клиент может менять условия, финансы и документы */
export const EDITABLE_STATUSES: AppStatus[] = ['IN_QUEUE', 'IN_REVIEW', 'NEED_INFO'];
export const isEditable = (s: AppStatus) => EDITABLE_STATUSES.includes(s);

export const isWithdrawable = (s: AppStatus) => canTransition(s, 'WITHDRAWN');

/** Переписка со специалистом открыта от отправки до выдачи */
export const canMessage = (s: AppStatus) => s !== 'DRAFT' && !isFinal(s);

export const isChecking = (s: AppStatus) => s === 'SUBMITTED' || s === 'AUTO_CHECKS';
