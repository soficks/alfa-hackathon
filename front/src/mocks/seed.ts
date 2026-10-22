import type { Account, Application, AppStatus, DbState, DocFile, DocType, PaymentType, User } from '../domain/types.ts';
import { DAY, HOUR, MINUTE, addBusinessDays } from '../domain/time.ts';
import { goalById, productById } from '../config/products.ts';
import { rejectReason } from '../config/rejectReasons.ts';
import { previousMonthName } from '../utils/format.ts';
import { lookupCompany, DEMO_CLIENT_INN } from './registry.ts';
import {
  acceptOffer,
  actorOf,
  addDocuments,
  declineOffer,
  issue,
  makeDecision,
  markSeen,
  prefillFinancials,
  rejectApplication,
  requestDocuments,
  runPipelineSync,
  sendMessage,
  signDocuments,
  submit,
  takeToWork,
  withEvent,
  withdraw,
  type Actor,
} from './operations.ts';

/**
 * Демо-данные. Все даты — смещения от текущего момента, баллы считает модель.
 * Номера заявок уникальны и общие для клиента и сотрудника.
 */

export const CLIENT_ID = 'u-client';
export const ANNA_ID = 'e-anna';
export const PAVEL_ID = 'e-pavel';

export const USERS: User[] = [
  {
    id: CLIENT_ID,
    role: 'client',
    firstName: 'Юлия',
    lastName: 'Иванова',
    position: 'Руководитель',
    email: 'demo@example.com',
    phone: '+7 999 000-00-00',
    companyInn: DEMO_CLIENT_INN,
    authority: 'Генеральный директор, действует на основании устава',
  },
  { id: ANNA_ID, role: 'employee', firstName: 'Анна', lastName: 'Смирнова', position: 'Андеррайтер', email: 'a.smirnova@bank.demo', phone: '' },
  { id: PAVEL_ID, role: 'employee', firstName: 'Павел', lastName: 'Орлов', position: 'Андеррайтер', email: 'p.orlov@bank.demo', phone: '' },
];

export const ACCOUNTS: Account[] = [
  { number: '40702810400000012345', title: 'Расчётный счёт', companyInn: DEMO_CLIENT_INN },
  { number: '40702810900000067890', title: 'Счёт для расчётов с поставщиками', companyInn: DEMO_CLIENT_INN },
];

const DOC_NAMES: Record<DocType, string> = {
  bank_statement: 'Выписка по счёту за 12 месяцев.pdf',
  financial_statements: 'Бухгалтерская отчётность за 2025 год.pdf',
  supplier_invoice: 'Счёт поставщика.pdf',
  purchase_contract: 'Договор купли-продажи.pdf',
  estimate: 'Смета на ремонт.xlsx',
  business_plan: 'Бизнес-план.docx',
  gov_contract: 'Госконтракт.pdf',
  debt_certificate: 'Справка о задолженности.pdf',
  other: 'Документ.pdf',
};

const SIZES = [248_000, 1_840_000, 412_000, 96_000, 154_000, 2_400_000, 310_000];

function demoDoc(type: DocType, at: Date, i: number, name = DOC_NAMES[type]): Omit<DocFile, 'source' | 'addedBy'> {
  return { id: `doc-${type}-${at.getTime()}-${i}`, name, size: SIZES[i % SIZES.length], docType: type, addedAt: at.toISOString(), demo: true };
}

interface Spec {
  id: string;
  inn: string;
  goalId: string;
  subgoalId?: string;
  amount: number;
  term: number;
  paymentType: PaymentType;
  graceMonths?: number;
  docs: DocType[];
  owner?: string;
  /** заявка поступила столько-то назад */
  submittedAgo: number;
  /** какой статус ждём после авто-проверок — защита от рассинхрона с моделью */
  expect: AppStatus;
}

function createAndSubmit(spec: Spec, now: Date): Application {
  const company = lookupCompany(spec.inn, now);
  const product = productById(goalById(spec.goalId).productId);
  const submittedAt = new Date(now.getTime() - spec.submittedAgo);
  const createdAt = new Date(submittedAt.getTime() - 25 * MINUTE);
  const client: Actor = spec.owner === CLIENT_ID ? actorOf(USERS[0]) : { role: 'client', name: company.head };
  let app: Application = {
    id: spec.id,
    ownerUserId: spec.owner ?? `u-${spec.inn}`,
    company,
    goalId: spec.goalId,
    subgoalId: spec.subgoalId,
    productId: product.id,
    requested: { amount: spec.amount, term: spec.term, rate: product.baseRate, paymentType: spec.paymentType, graceMonths: spec.graceMonths },
    indicativeRate: product.baseRate,
    status: 'DRAFT',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    financials: prefillFinancials(spec.inn),
    documents: spec.docs.map((t, i) => ({ ...demoDoc(t, createdAt, i), addedBy: 'client' as const, source: 'submission' as const })),
    docRequests: [],
    consents: { bki: true, personalData: true, authority: true },
    checks: [],
    messages: [],
    history: [],
    version: 1,
    changes: [],
  };
  app = withEvent(app, createdAt, client, 'draft_saved', 'Черновик сохранён');
  app = submit(app, submittedAt, client);
  app = runPipelineSync(app, submittedAt);
  if (app.status !== spec.expect) {
    throw new Error(`Сид № ${spec.id}: ожидали ${spec.expect}, модель дала ${app.status} (балл ${app.scoring?.score})`);
  }
  return app;
}

const clientOf = (app: Application): Actor =>
  app.ownerUserId === CLIENT_ID ? actorOf(USERS[0]) : { role: 'client', name: app.company.head };

export function createSeed(now = new Date()): DbState {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const anna = actorOf(USERS[1]);
  const pavel = actorOf(USERS[2]);
  const prevMonth = previousMonthName(now);
  const apps: Application[] = [];

  /* ---------- Клиент: Юлия Иванова, ООО «Пример» ---------- */

  // Черновик, остановились на шаге «Финансы и документы»
  {
    const createdAt = ago(2 * DAY + 3 * HOUR);
    const product = productById('development');
    let draft: Application = {
      id: '20101',
      ownerUserId: CLIENT_ID,
      company: lookupCompany(DEMO_CLIENT_INN, now),
      goalId: 'growth',
      subgoalId: 'new_point',
      productId: product.id,
      requested: { amount: 1_500_000, term: 36, rate: product.baseRate, paymentType: 'annuity' },
      indicativeRate: product.baseRate,
      status: 'DRAFT',
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      financials: prefillFinancials(DEMO_CLIENT_INN),
      documents: [{ ...demoDoc('bank_statement', createdAt, 0), addedBy: 'client', source: 'submission' }],
      docRequests: [],
      consents: { bki: false, personalData: false, authority: false },
      checks: [],
      messages: [],
      history: [],
      version: 1,
      changes: [],
      draftStep: 2,
    };
    draft = withEvent(draft, createdAt, actorOf(USERS[0]), 'draft_saved', 'Черновик сохранён');
    apps.push(draft);
  }

  // Нужны документы: специалист запросил выписку за прошлый месяц
  {
    let a = createAndSubmit(
      { id: '20102', inn: DEMO_CLIENT_INN, goalId: 'working', subgoalId: 'goods', amount: 4_000_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], owner: CLIENT_ID, submittedAgo: 2 * DAY, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(26 * HOUR));
    const reqAt = ago(25 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'bank_statement', comment: `Выписка за ${prevMonth}: в загруженной выписке нет операций за этот месяц.` }], addBusinessDays(reqAt, 2), reqAt);
    a = sendMessage(
      a,
      anna,
      `Юлия, добрый день! В выписке нет операций за ${prevMonth}. Загрузите, пожалуйста, выписку за этот месяц — после этого продолжу проверку.`,
      ago(25 * HOUR - 2 * MINUTE),
    );
    apps.push(a);
  }

  // На рассмотрении у Анны: клиент только что закрыл запрос — «Новые документы»
  {
    let a = createAndSubmit(
      { id: '20103', inn: DEMO_CLIENT_INN, goalId: 'transport', subgoalId: 'truck', amount: 3_600_000, term: 48, paymentType: 'annuity', docs: ['bank_statement'], owner: CLIENT_ID, submittedAgo: 30 * HOUR, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(27 * HOUR));
    const reqAt = ago(26 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'purchase_contract', comment: 'Нужен договор или счёт на грузовик, который вы покупаете.' }], addBusinessDays(reqAt, 2), reqAt);
    a = markSeen(a, 'client');
    a = addDocuments(a, clientOf(a), [demoDoc('purchase_contract', ago(40 * MINUTE), 3)], ago(40 * MINUTE));
    a = sendMessage(a, clientOf(a), 'Добавила договор купли-продажи на грузовик.', ago(38 * MINUTE));
    apps.push(a);
  }

  // Встречное предложение от Анны
  {
    let a = createAndSubmit(
      { id: '20104', inn: DEMO_CLIENT_INN, goalId: 'equipment', subgoalId: 'new', amount: 5_000_000, term: 36, paymentType: 'differentiated', docs: ['bank_statement', 'supplier_invoice'], owner: CLIENT_ID, submittedAgo: 3 * DAY, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(2 * DAY + 20 * HOUR));
    a = makeDecision(
      a,
      anna,
      {
        type: 'counter_offer',
        terms: { amount: 4_000_000, term: 36, rate: 19, paymentType: 'differentiated' },
        validDays: 5,
        justification: 'Оборот позволяет обслуживать 4 млн; по счёту поставщика часть оборудования можно оплатить из собственных средств.',
        clientMessage: 'Можем выдать 4 млн ₽ на тех же условиях — этого хватит на основную часть оборудования по счёту.',
      },
      ago(20 * HOUR),
    );
    apps.push(markSeen(a, 'client'));
  }

  // Отказ (прошлый месяц)
  {
    let a = createAndSubmit(
      { id: '20105', inn: DEMO_CLIENT_INN, goalId: 'refinance', amount: 25_000_000, term: 60, paymentType: 'annuity', docs: ['bank_statement', 'debt_certificate'], owner: CLIENT_ID, submittedAgo: 36 * DAY, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(35 * DAY + 20 * HOUR));
    const reason = rejectReason('high_debt_load');
    a = rejectApplication(
      a,
      anna,
      {
        reasonCode: reason.code,
        justification: 'Долговая нагрузка с новым кредитом превысит 70% годовой выручки, а сумма к рефинансированию больше текущих долгов по справке.',
        clientMessage: reason.clientMessage,
      },
      ago(35 * DAY + 2 * HOUR),
    );
    apps.push(markSeen(a, 'client'));
  }

  // Выдан (прошлый месяц): система одобрила сама, клиент подписал и выбрал счёт
  {
    let a = createAndSubmit(
      { id: '20106', inn: DEMO_CLIENT_INN, goalId: 'working', subgoalId: 'goods', amount: 1_500_000, term: 12, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], owner: CLIENT_ID, submittedAgo: 40 * DAY, expect: 'APPROVED' },
      now,
    );
    const c = clientOf(a);
    a = acceptOffer(a, c, ago(40 * DAY - 2 * HOUR));
    a = signDocuments(a, c, ago(40 * DAY - 2 * HOUR + 10 * MINUTE));
    a = issue(a, c, ACCOUNTS[0].number, ago(40 * DAY - 2 * HOUR + 12 * MINUTE));
    apps.push(markSeen(a, 'client'));
  }

  /* ---------- Очередь (другие компании) ---------- */

  // Высокий балл, но сумма выше авто-лимита
  apps.push(
    createAndSubmit({ id: '20111', inn: '5027456784', goalId: 'equipment', subgoalId: 'new', amount: 6_000_000, term: 48, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 3 * HOUR, expect: 'IN_QUEUE' }, now),
  );
  // Ручная зона, просрочена по сроку проверки
  apps.push(
    createAndSubmit({ id: '20112', inn: '5008678904', goalId: 'working', subgoalId: 'expenses', amount: 3_500_000, term: 18, paymentType: 'differentiated', docs: ['bank_statement', 'financial_statements'], submittedAgo: 4 * DAY, expect: 'IN_QUEUE' }, now),
  );
  // Высокий риск
  apps.push(
    createAndSubmit({ id: '20113', inn: '502478901250', goalId: 'growth', subgoalId: 'new_line', amount: 3_000_000, term: 36, paymentType: 'annuity', docs: ['bank_statement'], submittedAgo: 5 * HOUR, expect: 'IN_QUEUE' }, now),
  );
  // Ручная зона: молодой бизнес
  apps.push(
    createAndSubmit({ id: '20114', inn: '770367890190', goalId: 'working', subgoalId: 'goods', amount: 600_000, term: 12, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 90 * MINUTE, expect: 'IN_QUEUE' }, now),
  );
  // У другого сотрудника — только просмотр
  {
    let a = createAndSubmit({ id: '20115', inn: '7726789010', goalId: 'working', subgoalId: 'payroll', amount: 3_200_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 7 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, pavel, ago(6 * HOUR));
    apps.push(a);
  }

  /* ---------- «Мои проверки» Анны ---------- */

  // АльфаТех: обороты за 3 месяца падают
  {
    let a = createAndSubmit({ id: '20121', inn: '7701111110', goalId: 'working', subgoalId: 'payroll', amount: 10_000_000, term: 12, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 20 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(2 * HOUR));
    apps.push(a);
  }
  // Готова к решению: все проверки пройдены
  {
    let a = createAndSubmit({ id: '20122', inn: '500312345614', goalId: 'equipment', subgoalId: 'upgrade', amount: 3_500_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 9 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(8 * HOUR));
    apps.push(a);
  }
  // Ждём клиента, срок ответа прошёл
  {
    let a = createAndSubmit({ id: '20124', inn: '7810345670', goalId: 'transport', subgoalId: 'truck', amount: 3_400_000, term: 48, paymentType: 'annuity', docs: ['bank_statement'], submittedAgo: 6 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(6 * DAY - 3 * HOUR));
    const reqAt = ago(6 * DAY - 4 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'purchase_contract', comment: 'Пришлите договор купли-продажи или счёт на транспорт.' }], addBusinessDays(reqAt, 2), reqAt);
    apps.push(a);
  }

  /* ---------- «История» Анны ---------- */

  // Одобрено → выдан
  {
    let a = createAndSubmit({ id: '20131', inn: '7715234560', goalId: 'equipment', subgoalId: 'new', amount: 4_500_000, term: 36, paymentType: 'annuity', docs: ['bank_statement'], submittedAgo: 9 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(8 * DAY + 20 * HOUR));
    const reqAt = ago(8 * DAY + 19 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'supplier_invoice', comment: 'Нужен счёт или спецификация на станок.' }], addBusinessDays(reqAt, 2), reqAt);
    a = addDocuments(a, clientOf(a), [demoDoc('supplier_invoice', ago(8 * DAY + 2 * HOUR), 3)], ago(8 * DAY + 2 * HOUR));
    a = makeDecision(
      a,
      anna,
      {
        type: 'approve',
        terms: { amount: 4_500_000, term: 36, rate: 18, paymentType: 'annuity' },
        validDays: 5,
        justification: 'Поступления по счёту подтверждают оборот, просрочек нет, счёт поставщика соответствует сумме.',
        clientMessage: '',
      },
      ago(8 * DAY),
    );
    const c = clientOf(a);
    a = acceptOffer(a, c, ago(7 * DAY + 5 * HOUR));
    a = signDocuments(a, c, ago(7 * DAY + 4 * HOUR));
    a = issue(a, c, '40702810100000054321', ago(7 * DAY + 4 * HOUR - 5 * MINUTE));
    apps.push(a);
  }
  // Одобрено → ждём подписания
  {
    let a = createAndSubmit({ id: '20132', inn: '5027456784', goalId: 'transport', subgoalId: 'special', amount: 4_000_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'purchase_contract'], submittedAgo: 4 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(3 * DAY + 22 * HOUR));
    a = makeDecision(
      a,
      anna,
      {
        type: 'approve',
        terms: { amount: 4_000_000, term: 36, rate: 18, paymentType: 'annuity' },
        validDays: 5,
        justification: 'Высокий балл, стабильные обороты, договор на спецтехнику проверен. Сумма выше авто-лимита — подтверждаю вручную.',
        clientMessage: '',
      },
      ago(3 * DAY + 20 * HOUR),
    );
    a = acceptOffer(a, clientOf(a), ago(3 * DAY));
    apps.push(a);
  }
  // Встречное → клиент отказался (прошлый месяц)
  {
    let a = createAndSubmit({ id: '20133', inn: '7730890126', goalId: 'equipment', subgoalId: 'upgrade', amount: 6_000_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 30 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(29 * DAY + 20 * HOUR));
    a = makeDecision(
      a,
      anna,
      {
        type: 'counter_offer',
        terms: { amount: 4_000_000, term: 48, rate: 19, paymentType: 'annuity' },
        validDays: 5,
        justification: 'Платёж по 6 млн на 36 мес. превышает 35% оборота; на 4 млн и 48 мес. нагрузка допустимая.',
        clientMessage: 'Можем выдать 4 млн ₽ на 48 месяцев — так платёж будет комфортнее для ваших оборотов.',
      },
      ago(29 * DAY),
    );
    a = declineOffer(a, clientOf(a), 'Нужна вся сумма сразу', ago(27 * DAY));
    apps.push(a);
  }
  // Клиент отозвал заявку во время проверки
  {
    let a = createAndSubmit({ id: '20134', inn: '7716901231', goalId: 'working', subgoalId: 'goods', amount: 3_300_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 6 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(5 * DAY + 20 * HOUR));
    a = sendMessage(a, clientOf(a), 'Получили оплату от покупателя, кредит больше не нужен. Отзываю заявку.', ago(5 * DAY + 4 * HOUR));
    a = withdraw(a, clientOf(a), ago(5 * DAY + 4 * HOUR - MINUTE));
    apps.push(markSeen(a, 'employee'));
  }

  // Сотрудник уже прочитал всё, кроме свежего сообщения в 20103
  const settled = apps.map((a) => (a.id === '20103' ? a : markSeenEmployee(a)));

  return {
    schema: 3,
    seededAt: now.toISOString(),
    users: USERS,
    companies: [lookupCompany(DEMO_CLIENT_INN, now)],
    accounts: ACCOUNTS,
    applications: settled.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    wizards: {},
    botChats: {},
  };
}

function markSeenEmployee(a: Application): Application {
  return { ...a, messages: a.messages.map((m) => ({ ...m, readByEmployee: true })) };
}

