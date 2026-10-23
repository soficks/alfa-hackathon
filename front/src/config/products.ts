import type { DocType, PaymentType } from '../domain/types.ts';
import { POLICY } from './policy.ts';

/** Шаг суммы для всех продуктов */
export const AMOUNT_STEP = 50_000;
/** До этой суммы система может одобрить сама (см. config/policy.ts) */
export const AUTO_LIMIT = POLICY.AUTO_AUTHORITY;
/** Меньше — предупреждение */
export const MIN_BUSINESS_AGE_MONTHS = 12;
/** Меньше — стоп-фактор */
export const STOP_BUSINESS_AGE_MONTHS = 6;
/** Сколько дней действует одобрение или встречное предложение (§15 ТЗ) */
export const OFFER_VALID_DAYS = POLICY.OFFER_TTL_DAYS;
/** Сколько рабочих дней даём клиенту на ответ по запросу документов */
export const DOC_REQUEST_DAYS = POLICY.NEED_INFO_DAYS;
/** Срок проверки: рабочих дней от поступления */
export const SLA_BUSINESS_DAYS = POLICY.REVIEW_SLA_DAYS;

export type Illustration = 'working' | 'equipment' | 'growth';

export interface Product {
  id: string;
  name: string;
  /** коротко и простыми словами */
  description: string;
  minAmount: number;
  maxAmount: number;
  minTerm: number;
  maxTerm: number;
  /** ориентировочная ставка, % годовых */
  baseRate: number;
  paymentTypes: PaymentType[];
  /** для annuity_grace */
  maxGraceMonths?: number;
  requiredDocs: DocType[];
  collateral: { required: boolean; note: string };
  autoLimit: number;
}

export interface Goal {
  id: string;
  title: string;
  subgoals: { id: string; title: string }[];
  productId: string;
  illustration: Illustration;
}

const NO_COLLATERAL = { required: false, note: 'Залог не нужен' };

export const PRODUCTS: Product[] = [
  {
    id: 'working_capital',
    name: 'Оборотный кредит',
    description: 'Деньги на текущие нужды бизнеса: закупки, зарплаты, налоги.',
    minAmount: 300_000,
    maxAmount: 30_000_000,
    minTerm: 3,
    maxTerm: 24,
    baseRate: 21,
    paymentTypes: ['annuity', 'differentiated'],
    requiredDocs: ['bank_statement', 'financial_statements'],
    collateral: NO_COLLATERAL,
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'credit_line',
    name: 'Кредитная линия',
    description: 'Закроет паузу между расходами и оплатой от покупателей. Долг возвращается одной суммой.',
    minAmount: 300_000,
    maxAmount: 30_000_000,
    minTerm: 1,
    maxTerm: 18,
    baseRate: 22,
    paymentTypes: ['interest_only'],
    requiredDocs: ['bank_statement'],
    collateral: NO_COLLATERAL,
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'investment',
    name: 'Инвестиционный кредит',
    description: 'На новое или подержанное оборудование. Можно взять отсрочку, пока оборудование запускается.',
    minAmount: 500_000,
    maxAmount: 50_000_000,
    minTerm: 12,
    maxTerm: 60,
    baseRate: 19,
    paymentTypes: ['annuity', 'differentiated', 'annuity_grace'],
    maxGraceMonths: 3,
    requiredDocs: ['bank_statement', 'supplier_invoice'],
    collateral: { required: false, note: 'Залогом может стать само оборудование — не обязательно' },
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'transport',
    name: 'Кредит на транспорт',
    description: 'На грузовой или легковой транспорт и спецтехнику для бизнеса.',
    minAmount: 300_000,
    maxAmount: 50_000_000,
    minTerm: 12,
    maxTerm: 60,
    baseRate: 19,
    paymentTypes: ['annuity', 'differentiated'],
    requiredDocs: ['bank_statement', 'purchase_contract'],
    collateral: { required: false, note: 'Залогом может стать сам транспорт — не обязательно' },
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'real_estate',
    name: 'Кредит под залог недвижимости',
    description: 'На покупку или ремонт помещения для бизнеса. Большие суммы и долгий срок.',
    minAmount: 1_000_000,
    maxAmount: 150_000_000,
    minTerm: 12,
    maxTerm: 120,
    baseRate: 18,
    paymentTypes: ['annuity', 'differentiated'],
    requiredDocs: ['bank_statement', 'estimate', 'collateral'],
    collateral: { required: true, note: 'Нужен залог: покупаемое или другое коммерческое помещение' },
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'development',
    name: 'Кредит на развитие',
    description: 'На новую точку, направление или команду. Можно взять отсрочку на запуск.',
    minAmount: 500_000,
    maxAmount: 30_000_000,
    minTerm: 12,
    maxTerm: 60,
    baseRate: 21,
    paymentTypes: ['annuity', 'differentiated', 'annuity_grace'],
    maxGraceMonths: 3,
    requiredDocs: ['bank_statement', 'business_plan'],
    collateral: NO_COLLATERAL,
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'gov_contract',
    name: 'Кредит под контракт',
    description: 'Чтобы исполнить госконтракт до оплаты от заказчика. Долг возвращается из оплаты по контракту.',
    minAmount: 300_000,
    maxAmount: 30_000_000,
    minTerm: 1,
    maxTerm: 24,
    baseRate: 20,
    paymentTypes: ['interest_only'],
    requiredDocs: ['bank_statement', 'gov_contract'],
    collateral: NO_COLLATERAL,
    autoLimit: AUTO_LIMIT,
  },
  {
    id: 'refinance',
    name: 'Рефинансирование',
    description: 'Объединит кредиты других банков в один, чтобы платить меньше или удобнее.',
    minAmount: 500_000,
    maxAmount: 150_000_000,
    minTerm: 12,
    maxTerm: 120,
    baseRate: 19,
    paymentTypes: ['annuity', 'differentiated'],
    requiredDocs: ['bank_statement', 'debt_certificate'],
    collateral: NO_COLLATERAL,
    autoLimit: AUTO_LIMIT,
  },
];

export const GOALS: Goal[] = [
  {
    id: 'working',
    title: 'Пополнить оборотные средства',
    subgoals: [
      { id: 'goods', title: 'Закупка товара и сырья' },
      { id: 'payroll', title: 'Зарплата и налоги' },
      { id: 'expenses', title: 'Текущие расходы' },
    ],
    productId: 'working_capital',
    illustration: 'working',
  },
  {
    id: 'cash_gap',
    title: 'Закрыть кассовый разрыв',
    subgoals: [
      { id: 'receivables', title: 'Ждём оплату от покупателей' },
      { id: 'seasonal', title: 'Сезонные закупки' },
    ],
    productId: 'credit_line',
    illustration: 'working',
  },
  {
    id: 'equipment',
    title: 'Купить оборудование',
    subgoals: [
      { id: 'new', title: 'Новое' },
      { id: 'used', title: 'Б/у' },
      { id: 'upgrade', title: 'Модернизация производства' },
    ],
    productId: 'investment',
    illustration: 'equipment',
  },
  {
    id: 'transport',
    title: 'Купить транспорт или спецтехнику',
    subgoals: [
      { id: 'truck', title: 'Грузовой' },
      { id: 'car', title: 'Легковой' },
      { id: 'special', title: 'Спецтехника' },
    ],
    productId: 'transport',
    illustration: 'equipment',
  },
  {
    id: 'real_estate',
    title: 'Коммерческая недвижимость',
    subgoals: [
      { id: 'buy', title: 'Покупка' },
      { id: 'repair', title: 'Ремонт' },
    ],
    productId: 'real_estate',
    illustration: 'growth',
  },
  {
    id: 'growth',
    title: 'Развивать бизнес',
    subgoals: [
      { id: 'new_point', title: 'Новая точка' },
      { id: 'new_line', title: 'Новое направление' },
      { id: 'team', title: 'Расширение команды' },
    ],
    productId: 'development',
    illustration: 'growth',
  },
  {
    id: 'gov_contract',
    title: 'Исполнить госконтракт',
    subgoals: [],
    productId: 'gov_contract',
    illustration: 'working',
  },
  {
    id: 'refinance',
    title: 'Рефинансировать кредиты',
    subgoals: [],
    productId: 'refinance',
    illustration: 'growth',
  },
];

export const productById = (id: string) => {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Неизвестный продукт: ${id}`);
  return p;
};

export const goalById = (id: string) => {
  const g = GOALS.find((x) => x.id === id);
  if (!g) throw new Error(`Неизвестная цель: ${id}`);
  return g;
};

export const productForGoal = (goalId: string) => productById(goalById(goalId).productId);

export const subgoalTitle = (goalId: string, subgoalId?: string) =>
  goalById(goalId).subgoals.find((s) => s.id === subgoalId)?.title;

/* ---------- Шкалы для ползунков ---------- */

const AMOUNT_MARKS = [300_000, 500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000, 50_000_000, 100_000_000, 150_000_000];
const TERM_MARKS = [1, 3, 6, 12, 18, 24, 36, 48, 60, 84, 120];

function pickMarks(marks: number[], min: number, max: number, count: number) {
  const inner = marks.filter((m) => m > min && m < max);
  const take = Math.max(0, count - 2);
  const chosen: number[] = [];
  for (let i = 0; i < take && inner.length; i++) {
    const idx = Math.round(((i + 1) * (inner.length + 1)) / (take + 1)) - 1;
    const v = inner[Math.min(inner.length - 1, Math.max(0, idx))];
    if (!chosen.includes(v)) chosen.push(v);
  }
  return [min, ...chosen.sort((a, b) => a - b), max];
}

/** Опорные точки ползунка суммы: равномерно по треку, неравномерно по значениям */
export const amountPoints = (p: Product) => pickMarks(AMOUNT_MARKS, p.minAmount, p.maxAmount, 6);
export const termPoints = (p: Product) => pickMarks(TERM_MARKS, p.minTerm, p.maxTerm, 6);
/** Быстрые суммы в пределах продукта */
export const amountPresets = (p: Product) => pickMarks(AMOUNT_MARKS, p.minAmount, p.maxAmount, 5);

/** Ставку в решении сотрудник может менять в этих пределах от ориентировочной */
export const rateBounds = (p: Product) => ({ min: p.baseRate - 3, max: p.baseRate + 6 });

export const clampToProduct = (p: Product, amount: number, term: number) => ({
  amount: Math.min(p.maxAmount, Math.max(p.minAmount, Math.round(amount / AMOUNT_STEP) * AMOUNT_STEP)),
  term: Math.min(p.maxTerm, Math.max(p.minTerm, Math.round(term))),
});
