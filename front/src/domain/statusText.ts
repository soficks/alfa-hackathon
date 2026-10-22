import type { Application, AppStatus, DocRequest } from './types.ts';
import { DOC_TYPES } from '../config/docTypes.ts';
import { dayMonth } from '../utils/format.ts';

export type Tone = 'draft' | 'checking' | 'review' | 'info' | 'approved' | 'offer' | 'signing' | 'issued' | 'rejected' | 'muted';

export const STATUS_TONE: Record<AppStatus, Tone> = {
  DRAFT: 'draft',
  SUBMITTED: 'checking',
  AUTO_CHECKS: 'checking',
  IN_QUEUE: 'review',
  IN_REVIEW: 'review',
  NEED_INFO: 'info',
  APPROVED: 'approved',
  COUNTER_OFFER: 'offer',
  SIGNING: 'signing',
  ISSUED: 'issued',
  REJECTED: 'rejected',
  DECLINED_BY_CLIENT: 'muted',
  WITHDRAWN: 'muted',
};

export const CLIENT_STATUS_LABEL: Record<AppStatus, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Проверяем данные',
  AUTO_CHECKS: 'Проверяем данные',
  IN_QUEUE: 'На рассмотрении',
  IN_REVIEW: 'На рассмотрении у специалиста',
  NEED_INFO: 'Нужны документы',
  APPROVED: 'Одобрена',
  COUNTER_OFFER: 'Есть предложение',
  SIGNING: 'Подписание',
  ISSUED: 'Кредит выдан',
  REJECTED: 'Отказ',
  DECLINED_BY_CLIENT: 'Вы отказались от предложения',
  WITHDRAWN: 'Отозвана',
};

/* ---------- Этапы клиентского пути ---------- */

export const CLIENT_STAGES = ['Параметры', 'Проверка', 'Решение', 'Подписание', 'Выдача'] as const;
export type StageState = 'done' | 'current' | 'action' | 'todo' | 'fail';

const STAGE_OF: Record<AppStatus, [number, StageState] | null> = {
  DRAFT: [0, 'action'],
  SUBMITTED: [1, 'current'],
  AUTO_CHECKS: [1, 'current'],
  IN_QUEUE: [1, 'current'],
  IN_REVIEW: [1, 'current'],
  NEED_INFO: [1, 'action'],
  APPROVED: [2, 'action'],
  COUNTER_OFFER: [2, 'action'],
  SIGNING: [3, 'action'],
  ISSUED: [5, 'done'],
  REJECTED: [2, 'fail'],
  DECLINED_BY_CLIENT: [2, 'fail'],
  WITHDRAWN: null,
};

export function clientStageStates(status: AppStatus): StageState[] {
  const at = STAGE_OF[status];
  if (!at) return CLIENT_STAGES.map((_, i) => (i === 0 ? 'done' : 'todo'));
  const [index, mode] = at;
  return CLIENT_STAGES.map((_, i) => (i < index ? 'done' : i === index ? mode : 'todo'));
}

export function clientStageLabel(status: AppStatus) {
  const at = STAGE_OF[status];
  if (!at) return 'Заявка отозвана';
  if (at[0] >= CLIENT_STAGES.length) return 'Все этапы пройдены';
  return `Этап ${at[0] + 1} из ${CLIENT_STAGES.length} · ${CLIENT_STAGES[at[0]]}`;
}

/* ---------- Запросы документов ---------- */

export const openRequests = (app: Application): DocRequest[] => app.docRequests.filter((r) => !r.fulfilledByDocId);

export const requestTitles = (requests: DocRequest[]) => requests.map((r) => DOC_TYPES[r.docType].short.toLowerCase()).join(', ');

export function nearestDue(requests: DocRequest[]) {
  if (!requests.length) return undefined;
  return requests.map((r) => r.dueAt).sort()[0];
}

/* ---------- «Что дальше» ---------- */

export function clientNextStep(app: Application): string {
  switch (app.status) {
    case 'DRAFT':
      return 'Данные сохранены — продолжите с того же места.';
    case 'SUBMITTED':
    case 'AUTO_CHECKS':
      return 'Сверяем реквизиты и кредитную историю, это займёт пару секунд.';
    case 'IN_QUEUE':
      return 'Заявку проверит специалист, обычно в течение 1 рабочего дня.';
    case 'IN_REVIEW':
      return 'Специалист проверяет данные, от вас ничего не нужно.';
    case 'NEED_INFO': {
      const open = openRequests(app);
      const due = nearestDue(open);
      return `Загрузите: ${requestTitles(open)}${due ? ` до ${dayMonth(due)}` : ''}.`;
    }
    case 'APPROVED':
      return `Подтвердите условия${app.decision?.validUntil ? ` до ${dayMonth(app.decision.validUntil)}` : ''}.`;
    case 'COUNTER_OFFER':
      return 'Банк предлагает другие условия — сравните и решите.';
    case 'SIGNING':
      return app.signedAt ? 'Документы подписаны. Выберите счёт для зачисления.' : 'Подпишите документы и выберите счёт для зачисления.';
    case 'ISSUED':
      return `Деньги зачислены на счёт ${app.issued?.accountNumber ?? ''}.`.replace(' .', '.');
    case 'REJECTED':
      return app.decision?.clientMessage ?? 'Банк не может выдать кредит на этих условиях.';
    case 'DECLINED_BY_CLIENT':
      return 'Можно подать новую заявку с другими условиями.';
    case 'WITHDRAWN': {
      const ev = [...app.history].reverse().find((e) => e.type === 'withdrawn');
      return `Заявка отозвана вами ${dayMonth(ev?.at ?? app.updatedAt)}.`;
    }
  }
}

/** Клиенту нужно что-то сделать */
export const clientNeedsAction = (app: Application) => ['NEED_INFO', 'APPROVED', 'COUNTER_OFFER', 'SIGNING'].includes(app.status);

/* ---------- Сотрудник ---------- */

export function employeeStatusLabel(app: Application, nameOf: (userId?: string) => string): string {
  switch (app.status) {
    case 'DRAFT':
      return 'Черновик';
    case 'SUBMITTED':
    case 'AUTO_CHECKS':
      return 'Авто-проверки';
    case 'IN_QUEUE':
      return 'Новая, в очереди';
    case 'IN_REVIEW':
      return `В работе: ${nameOf(app.assigneeId)}`;
    case 'NEED_INFO':
      return 'Ждём клиента';
    case 'APPROVED':
      return 'Одобрено, ждём клиента';
    case 'COUNTER_OFFER':
      return 'Встречное, ждём клиента';
    case 'SIGNING':
      return 'Подписание';
    case 'ISSUED':
      return 'Выдан';
    case 'REJECTED':
      return 'Отказано';
    case 'DECLINED_BY_CLIENT':
      return 'Клиент отказался';
    case 'WITHDRAWN':
      return 'Отозвана клиентом';
  }
}

export const zoneLabel = { high_risk: 'Высокий риск', manual: 'Ручная проверка', auto: 'Авто-одобрение' } as const;

