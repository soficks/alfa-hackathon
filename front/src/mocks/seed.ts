import type { Account, Application, AppStatus, DbState, DocFile, DocType, PaymentType, User } from '../domain/types.ts';
import { DAY, HOUR, MINUTE, addBusinessDays } from '../domain/time.ts';
import { goalById, productById } from '../config/products.ts';
import { rejectReason } from '../config/rejectReasons.ts';
import { previousMonthName } from '../utils/format.ts';
import { lookupCompany, DEMO_CLIENT_INN } from './registry.ts';
import { lastFullMonth } from './creditPolicy.ts';
import {
  acceptOffer,
  actorOf,
  addDocuments,
  declineOffer,
  issue,
  makeDecision,
  markSeen,
  prefillFinancials,
  reassess,
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
 * Демо-данные. Все даты — смещения от текущего момента, баллы и маршруты считает модель:
 * каждая заявка проходит те же операции и авто-проверки, что и в интерфейсе.
 * Номера заявок уникальны и общие для клиента и сотрудника.
 *
 * Покрытие: группы A–E, все зоны DSCR, авто-одобрение, авто-отказ (F01, H09),
 * авто-контрпредложение, серая зона, жёсткий стоп у заявки в работе.
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
  { id: PAVEL_ID, role: 'employee', firstName: 'Павел', lastName: 'Орлов', position: 'Старший андеррайтер', email: 'p.orlov@bank.demo', phone: '' },
];

export const ACCOUNTS: Account[] = [
  { number: '40702810400000012345', title: 'Расчётный счёт', companyInn: DEMO_CLIENT_INN },
  { number: '40702810900000067890', title: 'Счёт для расчётов с поставщиками', companyInn: DEMO_CLIENT_INN },
];

const DOC_NAMES: Record<DocType, string> = {
  bank_statement: 'Выписка по счёту за 12 месяцев.xlsx',
  financial_statements: 'Бухгалтерская отчётность за 2025 год.pdf',
  supplier_invoice: 'Счёт поставщика.pdf',
  purchase_contract: 'Договор купли-продажи.pdf',
  estimate: 'Смета на ремонт.xlsx',
  business_plan: 'Бизнес-план.docx',
  gov_contract: 'Госконтракт.pdf',
  debt_certificate: 'Справка о задолженности.pdf',
  collateral: 'Выписка ЕГРН и отчёт об оценке.pdf',
  other: 'Документ.pdf',
};

const SIZES = [248_000, 1_840_000, 412_000, 96_000, 154_000, 2_400_000, 310_000];

function demoDoc(type: DocType, at: Date, i: number, name = DOC_NAMES[type]): Omit<DocFile, 'source' | 'addedBy'> {
  return {
    id: `doc-${type}-${at.getTime()}-${i}`,
    name,
    size: SIZES[i % SIZES.length],
    docType: type,
    addedAt: at.toISOString(),
    demo: true,
    periodTo: type === 'bank_statement' ? lastFullMonth(at) : undefined,
  };
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
  /** ИП дал согласие на автоматизированное решение */
  automated?: boolean;
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
    consents: { bki: true, personalData: true, authority: true, automated: spec.automated },
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
    throw new Error(`Сид № ${spec.id}: ожидали ${spec.expect}, модель дала ${app.status} (${app.route?.summary})`);
  }
  return app;
}

const clientOf = (app: Application): Actor => (app.ownerUserId === CLIENT_ID ? actorOf(USERS[0]) : { role: 'client', name: app.company.head });

export function createSeed(now = new Date()): DbState {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const anna = actorOf(USERS[1]);
  const pavel = actorOf(USERS[2]);
  const prevMonth = previousMonthName(now);
  const apps: Application[] = [];
  const add = (a: Application) => apps.push(a);

  /* ---------- Клиент: Юлия Иванова, ООО «Пример» — 612 баллов, группа B (пример из ТЗ) ---------- */

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
    add(draft);
  }

  // Нужны документы: специалист запросил выписку за прошлый месяц
  {
    let a = createAndSubmit(
      { id: '20102', inn: DEMO_CLIENT_INN, goalId: 'working', subgoalId: 'goods', amount: 4_000_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], owner: CLIENT_ID, submittedAgo: 2 * DAY, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(26 * HOUR));
    const reqAt = ago(25 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'bank_statement', comment: `Выписка за ${prevMonth}: в загруженной выписке нет операций за этот месяц.` }], addBusinessDays(reqAt, 10), reqAt);
    a = sendMessage(a, anna, `Юлия, добрый день! В выписке нет операций за ${prevMonth}. Загрузите, пожалуйста, выписку за этот месяц — после этого продолжу проверку.`, ago(25 * HOUR - 2 * MINUTE));
    add(a);
  }

  // На рассмотрении у Анны: клиент только что прислал расшифровку долгов — «Новые документы»
  {
    let a = createAndSubmit(
      { id: '20103', inn: DEMO_CLIENT_INN, goalId: 'transport', subgoalId: 'truck', amount: 3_600_000, term: 48, paymentType: 'annuity', docs: ['bank_statement', 'purchase_contract'], owner: CLIENT_ID, submittedAgo: 30 * HOUR, expect: 'IN_QUEUE' },
      now,
    );
    a = takeToWork(a, anna, ago(27 * HOUR));
    const reqAt = ago(26 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'debt_certificate', comment: 'Расшифровка действующих кредитов: остатки и графики.' }], addBusinessDays(reqAt, 10), reqAt);
    a = markSeen(a, 'client');
    a = addDocuments(a, clientOf(a), [demoDoc('debt_certificate', ago(40 * MINUTE), 3)], ago(40 * MINUTE));
    a = sendMessage(a, clientOf(a), 'Добавила справку по действующему кредиту.', ago(38 * MINUTE));
    add(a);
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
        variant: 'counter',
        terms: { amount: 4_000_000, term: 36, rate: 19, paymentType: 'differentiated' },
        reasonCode: 'CNT-01',
        validDays: 30,
        justification: 'Стресс-DSCR на 5 млн ниже 0,9; на 4 млн стресс выше 1,0, а основную часть оборудования по счёту можно оплатить.',
        clientMessage: 'Можем выдать 4 млн ₽ на тех же условиях — этого хватит на основную часть оборудования по счёту.',
      },
      ago(20 * HOUR),
    );
    add(markSeen(a, 'client'));
  }

  // Отказ (прошлый месяц): рефинансирование 25 млн
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
        justification: 'Сумма к рефинансированию намного больше текущих долгов по справке, долговая нагрузка с новым кредитом непосильна.',
        clientMessage: reason.clientMessage,
      },
      ago(35 * DAY + 2 * HOUR),
    );
    add(markSeen(a, 'client'));
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
    add(markSeen(a, 'client'));
  }

  /* ---------- Очередь: разные группы и зоны DSCR ---------- */

  // ООО «Маяк» — группа B, DSCR в норме; сумма выше авто-лимита (G01)
  add(createAndSubmit({ id: '20111', inn: '5027456784', goalId: 'equipment', subgoalId: 'new', amount: 6_000_000, term: 48, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 3 * HOUR, expect: 'IN_QUEUE' }, now));
  // ООО «Гранит» — группа C, DSCR в пограничной зоне (шаг 6, G05); просрочена по сроку проверки
  add(createAndSubmit({ id: '20112', inn: '5008678904', goalId: 'working', subgoalId: 'expenses', amount: 2_900_000, term: 15, paymentType: 'differentiated', docs: ['bank_statement', 'financial_statements'], submittedAgo: 5 * DAY, expect: 'IN_QUEUE' }, now));
  // ООО «Полюс» — группа A, 8 млн на оборудование
  add(createAndSubmit({ id: '20113', inn: '7716901231', goalId: 'equipment', subgoalId: 'upgrade', amount: 8_000_000, term: 48, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 5 * HOUR, expect: 'IN_QUEUE' }, now));
  // ИП Белова — 10 месяцев (S01), группа C, нет согласия на авто-решение (G08)
  add(createAndSubmit({ id: '20114', inn: '770367890190', goalId: 'working', subgoalId: 'goods', amount: 600_000, term: 12, paymentType: 'annuity', docs: ['bank_statement'], submittedAgo: 90 * MINUTE, expect: 'IN_QUEUE' }, now));
  // ООО «Лидер» — у другого сотрудника, только просмотр
  {
    let a = createAndSubmit({ id: '20115', inn: '7726789010', goalId: 'working', subgoalId: 'payroll', amount: 3_200_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 7 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, pavel, ago(6 * HOUR));
    add(a);
  }

  /* ---------- Решения системы ---------- */

  // ИП Кузнецов — группа D: авто-отказ F01
  add(createAndSubmit({ id: '20116', inn: '502478901250', goalId: 'growth', subgoalId: 'new_line', amount: 3_000_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'business_plan'], submittedAgo: 2 * DAY, expect: 'REJECTED' }, now));
  // ИП Соколова — группа E: авто-отказ F01
  add(createAndSubmit({ id: '20117', inn: '772834567838', goalId: 'cash_gap', subgoalId: 'seasonal', amount: 1_200_000, term: 12, paymentType: 'interest_only', docs: ['bank_statement'], submittedAgo: 4 * DAY, expect: 'REJECTED' }, now));
  // ООО «Вектор» — группа A, запрос непосилен на 6 мес.: авто-контрпредложение
  add(createAndSubmit({ id: '20118', inn: '7715234560', goalId: 'working', subgoalId: 'goods', amount: 2_800_000, term: 6, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 26 * HOUR, expect: 'COUNTER_OFFER' }, now));
  // ООО «Комета» — текущая просрочка 45 дней: жёсткий стоп H09
  add(createAndSubmit({ id: '20119', inn: '7725123450', goalId: 'working', subgoalId: 'goods', amount: 1_000_000, term: 12, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 30 * HOUR, expect: 'REJECTED' }, now));

  /* ---------- «Мои проверки» Анны ---------- */

  // ООО «АльфаТех» — группа C, обороты падают, DSCR ниже 1,1 на запросе
  {
    let a = createAndSubmit({ id: '20121', inn: '7701111110', goalId: 'working', subgoalId: 'payroll', amount: 10_000_000, term: 12, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 20 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(2 * HOUR));
    add(a);
  }
  // ИП Морозова — группа A, все показатели в норме: готова к решению
  {
    let a = createAndSubmit({ id: '20122', inn: '500312345614', goalId: 'equipment', subgoalId: 'upgrade', amount: 3_500_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], automated: true, submittedAgo: 9 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(8 * HOUR));
    add(a);
  }
  // ООО «Ромашка» — уже в работе, а ФНС приостановила операции по счетам: жёсткий стоп H08
  {
    let a = createAndSubmit({ id: '20123', inn: '7730890126', goalId: 'equipment', subgoalId: 'new', amount: 3_200_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 28 * HOUR, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(26 * HOUR));
    a = { ...a, sources: { ...a.sources!, fnsBlocked: true, checkedAt: ago(3 * HOUR).toISOString() } };
    a = withEvent(a, ago(3 * HOUR), { role: 'system', name: 'Система' }, 'sources', 'Повторная проверка ФНС: операции по счетам приостановлены', { visibleToClient: false });
    a = reassess(a, ago(3 * HOUR), { role: 'system', name: 'Система' }, 'новые данные ФНС');
    add(a);
  }
  // ООО «Север» — группа B, DSCR ниже 1; ждём клиента, срок ответа прошёл
  {
    let a = createAndSubmit({ id: '20124', inn: '7810345670', goalId: 'transport', subgoalId: 'truck', amount: 3_400_000, term: 48, paymentType: 'annuity', docs: ['bank_statement', 'purchase_contract'], submittedAgo: 16 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(16 * DAY - 3 * HOUR));
    const reqAt = ago(16 * DAY - 4 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'debt_certificate', comment: 'Расшифровка обязательств и иска от контрагента.' }], addBusinessDays(reqAt, 10), reqAt);
    add(a);
  }

  /* ---------- «История» Анны ---------- */

  // Одобрено → выдан
  {
    let a = createAndSubmit({ id: '20131', inn: '7715234560', goalId: 'equipment', subgoalId: 'new', amount: 4_500_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 9 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(8 * DAY + 20 * HOUR));
    const reqAt = ago(8 * DAY + 19 * HOUR);
    a = requestDocuments(a, anna, [{ docType: 'financial_statements', comment: 'Отчётность за год — сверить выручку с выпиской.' }], addBusinessDays(reqAt, 10), reqAt);
    a = addDocuments(a, clientOf(a), [demoDoc('financial_statements', ago(8 * DAY + 2 * HOUR), 3)], ago(8 * DAY + 2 * HOUR));
    a = makeDecision(
      a,
      anna,
      {
        type: 'approve',
        variant: 'other_terms',
        terms: { amount: 4_500_000, term: 36, rate: 18, paymentType: 'annuity' },
        reasonCode: 'APR-01',
        validDays: 30,
        justification: 'Группа A, DSCR выше 2, стресс выше 1,3; отчётность подтверждает выручку. Ставка снижена на 1 п.п.',
        clientMessage: '',
      },
      ago(8 * DAY),
    );
    const c = clientOf(a);
    a = acceptOffer(a, c, ago(7 * DAY + 5 * HOUR));
    a = signDocuments(a, c, ago(7 * DAY + 4 * HOUR));
    a = issue(a, c, '40702810100000054321', ago(7 * DAY + 4 * HOUR - 5 * MINUTE));
    add(a);
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
        variant: 'as_requested',
        terms: { ...a.requested },
        reasonCode: 'APR-01',
        validDays: 30,
        justification: 'Группа B, DSCR и стресс в норме, договор на спецтехнику проверен. Сумма выше авто-лимита — подтверждаю вручную.',
        clientMessage: '',
      },
      ago(3 * DAY + 20 * HOUR),
    );
    a = acceptOffer(a, clientOf(a), ago(3 * DAY));
    add(a);
  }
  // Встречное → клиент отказался (прошлый месяц)
  {
    let a = createAndSubmit({ id: '20133', inn: '7730890126', goalId: 'equipment', subgoalId: 'upgrade', amount: 6_000_000, term: 36, paymentType: 'annuity', docs: ['bank_statement', 'supplier_invoice'], submittedAgo: 30 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(29 * DAY + 20 * HOUR));
    const best = a.recommendation?.alternatives[0]?.terms ?? { ...a.requested, amount: 4_000_000, term: 48 };
    a = makeDecision(
      a,
      anna,
      {
        type: 'counter_offer',
        variant: 'counter',
        terms: best,
        reasonCode: 'CNT-02',
        validDays: 30,
        justification: 'Платёж на 6 млн за 36 мес. не проходит стресс; подобран вариант из рекомендации системы.',
        clientMessage: 'Можем выдать кредит на других условиях — так платёж будет комфортнее для ваших оборотов.',
      },
      ago(29 * DAY),
    );
    a = declineOffer(a, clientOf(a), 'Нужна вся сумма сразу', ago(27 * DAY));
    add(a);
  }
  // Клиент отозвал заявку во время проверки
  {
    let a = createAndSubmit({ id: '20134', inn: '7716901231', goalId: 'working', subgoalId: 'goods', amount: 3_300_000, term: 24, paymentType: 'annuity', docs: ['bank_statement', 'financial_statements'], submittedAgo: 6 * DAY, expect: 'IN_QUEUE' }, now);
    a = takeToWork(a, anna, ago(5 * DAY + 20 * HOUR));
    a = sendMessage(a, clientOf(a), 'Получили оплату от покупателя, кредит больше не нужен. Отзываю заявку.', ago(5 * DAY + 4 * HOUR));
    a = withdraw(a, clientOf(a), ago(5 * DAY + 4 * HOUR - MINUTE));
    add(markSeen(a, 'employee'));
  }

  // Сотрудник уже прочитал всё, кроме свежего сообщения в 20103
  const settled = apps.map((a) => (a.id === '20103' ? a : { ...a, messages: a.messages.map((m) => ({ ...m, readByEmployee: true })) }));

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
