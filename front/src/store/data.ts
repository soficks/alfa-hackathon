import type { Application, AppStatus, Company, GoalId } from './types';
import { DEMO_RATE } from '../utils/finance';
import { previousMonthName } from '../utils/format';

export interface GoalInfo {
  id: GoalId;
  title: string;
  description: string;
  options: [string, string];
}

export const GOALS: GoalInfo[] = [
  {
    id: 'working',
    title: 'Оборотные средства',
    description: 'Поддержка текущей деятельности и закупок товаров и услуг',
    options: ['Закупить товар и сырьё', 'Оплатить текущие расходы'],
  },
  {
    id: 'equipment',
    title: 'На оборудование',
    description: 'Покупка и лизинг оборудования для развития бизнеса',
    options: ['Купить оборудование', 'Обновить производство'],
  },
  {
    id: 'growth',
    title: 'Развитие бизнеса',
    description: 'Инвестиции в новые направления и масштабирование',
    options: ['Открыть новую точку', 'Расширить команду'],
  },
];

export const goalById = (id: GoalId) => GOALS.find((g) => g.id === id)!;

/* ---------- Стейт-машина заявки ---------- */

export const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['MANUAL_REVIEW', 'NEED_INFO'],
  NEED_INFO: ['MANUAL_REVIEW'],
  MANUAL_REVIEW: ['APPROVED', 'COUNTER_OFFER', 'NEED_INFO'],
  COUNTER_OFFER: ['APPROVED'],
  APPROVED: [],
};

export const canTransition = (from: AppStatus, to: AppStatus) => TRANSITIONS[from].includes(to);

export const STATUS_LABEL: Record<AppStatus, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Отправлена',
  MANUAL_REVIEW: 'На рассмотрении',
  NEED_INFO: 'Нужны документы',
  COUNTER_OFFER: 'Есть предложение',
  APPROVED: 'Одобрена',
};

export const statusLabel = (app: Pick<Application, 'status' | 'accepted'>) =>
  app.status === 'APPROVED' && app.accepted ? 'Кредит выдан' : STATUS_LABEL[app.status];

/** Что происходит и что нужно от клиента — одна фраза. */
export function nextStepText(app: Application) {
  switch (app.status) {
    case 'DRAFT':
      return 'Заявка ещё не отправлена. Данные сохранены — продолжите с того же места.';
    case 'SUBMITTED':
      return 'Заявка принята. Скоро начнём проверку — от вас ничего не требуется.';
    case 'MANUAL_REVIEW':
      return 'Специалист проверяет данные. От вас пока ничего не требуется.';
    case 'NEED_INFO':
      return `Добавьте ${app.request ?? 'недостающие документы'}, чтобы продолжить рассмотрение.`;
    case 'COUNTER_OFFER':
      return 'Банк предлагает другие условия. Сравните их с запросом и примите предложение.';
    case 'APPROVED':
      return app.accepted
        ? 'Условия приняты, кредит выдан. Документы доступны в заявке.'
        : 'Заявка одобрена. Подтвердите условия, чтобы перейти к выдаче.';
  }
}

export function actionLabel(app: Application) {
  switch (app.status) {
    case 'DRAFT':
      return 'Продолжить';
    case 'NEED_INFO':
      return 'Добавить документы';
    case 'COUNTER_OFFER':
      return 'Посмотреть предложение';
    case 'APPROVED':
      return app.accepted ? 'Документы' : 'Принять условия';
    default:
      return 'Подробнее';
  }
}

/** Требует ли статус действия клиента — такие заявки подсвечиваем и показываем первыми. */
export const needsAction = (app: Application) =>
  app.status === 'NEED_INFO' || app.status === 'COUNTER_OFFER' || (app.status === 'APPROVED' && !app.accepted);

/* ---------- Этапы клиентского пути ---------- */

export const STAGES = ['Параметры', 'Отправка', 'Проверка', 'Решение', 'Выдача'] as const;

export type StageState = 'done' | 'current' | 'action' | 'todo';

export function stageStates(app: Application): StageState[] {
  const at = (index: number, mode: StageState): StageState[] =>
    STAGES.map((_, i) => (i < index ? 'done' : i === index ? mode : 'todo'));
  switch (app.status) {
    case 'DRAFT':
      return at(0, 'action');
    case 'SUBMITTED':
      return at(1, 'current');
    case 'MANUAL_REVIEW':
      return at(2, 'current');
    case 'NEED_INFO':
      return at(2, 'action');
    case 'COUNTER_OFFER':
      return at(3, 'action');
    case 'APPROVED':
      return app.accepted ? STAGES.map(() => 'done') : at(3, 'action');
  }
}

/* ---------- Демо-данные ---------- */

export const EMPTY_COMPANY: Company = {
  type: 'ООО',
  name: '',
  inn: '',
  ogrn: '',
  address: '',
  contact: '',
  phone: '',
  email: '',
};

export const DEMO_COMPANY: Company = {
  type: 'ООО',
  name: 'ООО «Пример»',
  inn: '7700001234',
  ogrn: '1027700005678',
  address: 'Москва, ул. Примерная, д. 1',
  contact: 'Юлия Иванова',
  phone: '+7 999 000-00-00',
  email: 'demo@example.com',
};

export const TAX_SYSTEMS = ['УСН', 'ОСНО', 'ПСН', 'ЕСХН'];

const statement = () => `выписку по счёту за ${previousMonthName()}`;

const doc = (name: string, size: number, addedAt: string) => ({ id: `${name}-${addedAt}`, name, size, addedAt, demo: true });

export function seedApplications(): Application[] {
  const base = { company: DEMO_COMPANY, revenue: '24000000', tax: 'УСН', option: 0, rate: DEMO_RATE };
  return [
    {
      ...base,
      id: '1042',
      goal: 'working',
      amount: 2_000_000,
      term: 24,
      status: 'NEED_INFO',
      createdAt: '2026-10-20T09:12:00',
      updatedAt: '2026-10-22T09:40:00',
      request: statement(),
      documents: [doc('Выписка за 6 месяцев.pdf', 248_000, '2026-10-20T09:10:00')],
      history: [
        { date: '2026-10-20T09:12:00', text: 'Заявка отправлена' },
        { date: '2026-10-20T11:30:00', text: 'Начата проверка данных' },
        { date: '2026-10-22T09:40:00', text: `Запрошена ${statement()}` },
      ],
    },
    {
      ...base,
      id: '1038',
      goal: 'equipment',
      amount: 1_500_000,
      term: 18,
      status: 'MANUAL_REVIEW',
      createdAt: '2026-10-18T14:40:00',
      updatedAt: '2026-10-19T10:05:00',
      documents: [
        doc('Выписка за 6 месяцев.pdf', 312_000, '2026-10-18T14:30:00'),
        doc('Счёт поставщика оборудования.pdf', 96_000, '2026-10-18T14:35:00'),
      ],
      history: [
        { date: '2026-10-18T14:40:00', text: 'Заявка отправлена' },
        { date: '2026-10-19T10:05:00', text: 'Заявка передана специалисту на рассмотрение' },
      ],
    },
    {
      ...base,
      id: '1021',
      goal: 'growth',
      amount: 3_000_000,
      term: 36,
      status: 'COUNTER_OFFER',
      offer: { amount: 2_500_000, term: 36, rate: 17 },
      createdAt: '2026-10-12T10:00:00',
      updatedAt: '2026-10-16T16:20:00',
      documents: [doc('Выписка за 6 месяцев.pdf', 280_000, '2026-10-12T09:50:00'), doc('Бизнес-план.docx', 154_000, '2026-10-12T09:55:00')],
      history: [
        { date: '2026-10-12T10:00:00', text: 'Заявка отправлена' },
        { date: '2026-10-13T12:00:00', text: 'Начата проверка данных' },
        { date: '2026-10-16T16:20:00', text: 'Банк подготовил встречное предложение' },
      ],
    },
    {
      ...base,
      id: '1050',
      goal: 'growth',
      option: 1,
      amount: 1_500_000,
      term: 36,
      status: 'DRAFT',
      step: 1,
      createdAt: '2026-10-21T18:05:00',
      updatedAt: '2026-10-21T18:05:00',
      documents: [],
      history: [{ date: '2026-10-21T18:05:00', text: 'Черновик сохранён' }],
    },
    {
      ...base,
      id: '1009',
      goal: 'working',
      amount: 500_000,
      term: 12,
      status: 'APPROVED',
      accepted: true,
      createdAt: '2026-09-28T10:00:00',
      updatedAt: '2026-10-10T11:00:00',
      documents: [
        doc('Выписка за 6 месяцев.pdf', 201_000, '2026-09-28T09:40:00'),
        doc('Кредитный договор.pdf', 412_000, '2026-10-10T11:00:00'),
        doc('График платежей.pdf', 88_000, '2026-10-10T11:00:00'),
      ],
      history: [
        { date: '2026-09-28T10:00:00', text: 'Заявка отправлена' },
        { date: '2026-09-29T15:10:00', text: 'Начата проверка данных' },
        { date: '2026-10-08T12:30:00', text: 'Заявка одобрена' },
        { date: '2026-10-10T11:00:00', text: 'Условия приняты, кредит выдан' },
      ],
    },
  ];
}
