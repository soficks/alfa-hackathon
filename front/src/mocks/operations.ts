import type {
  Application,
  AppStatus,
  CheckResult,
  Company,
  DocFile,
  DocType,
  Financials,
  HistoryEvent,
  PipelineStep,
  PipelineStepId,
  Role,
  Terms,
  User,
  Wizard,
} from '../domain/types.ts';
import { assertTransition, canMessage, isEditable } from '../domain/stateMachine.ts';
import { isValidInn, isValidRegistrationNumber } from '../domain/requisites.ts';
import { PAYMENT_TYPE_LABEL } from '../domain/finance.ts';
import { addBusinessDays, addDays, monthsBetween } from '../domain/time.ts';
import { openRequests } from '../domain/statusText.ts';
import { DOC_TYPES } from '../config/docTypes.ts';
import { MIN_BUSINESS_AGE_MONTHS, OFFER_VALID_DAYS, SLA_BUSINESS_DAYS, goalById, productById, type Product } from '../config/products.ts';
import { rejectReason } from '../config/rejectReasons.ts';
import { businessAge, fullDate, months, rub } from '../utils/format.ts';
import { lookupCompany } from './registry.ts';
import { bkiReport } from './bki.ts';
import { analyzeStatement } from './statement.ts';
import { score } from './scoring.ts';
import { decide, missingDocs, recommend } from './creditPolicy.ts';

/**
 * Операции над заявкой — чистые функции (app, …, at) → app.
 * Их вызывают и мок-API, и сид, поэтому сид согласован с моделью.
 */

export interface Actor {
  role: Role | 'system';
  id?: string;
  name: string;
}

export const SYSTEM: Actor = { role: 'system', name: 'Система' };
export const actorOf = (u: User): Actor => ({ role: u.role, id: u.id, name: `${u.firstName} ${u.lastName}` });

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const iso = (d: Date) => d.toISOString();

export function withEvent(
  app: Application,
  at: Date,
  actor: Actor,
  type: string,
  text: string,
  opts: { visibleToClient?: boolean; clientText?: string } = {},
): Application {
  const event: HistoryEvent = {
    id: uid('ev'),
    at: iso(at),
    actor: actor.role,
    actorName: actor.name,
    type,
    text,
    clientText: opts.clientText,
    visibleToClient: opts.visibleToClient ?? true,
  };
  return { ...app, updatedAt: iso(at), history: [...app.history, event] };
}

function moveTo(app: Application, to: AppStatus, at: Date): Application {
  assertTransition(app.status, to);
  return { ...app, status: to, updatedAt: iso(at) };
}

export const productOf = (app: Pick<Application, 'productId'>) => productById(app.productId);

/** Итоговые условия: после решения — из решения, иначе запрошенные */
export const finalTerms = (app: Application): Terms => app.decision?.terms ?? app.requested;

/* ---------- Черновик ---------- */

export function draftFromWizard(w: Wizard, user: User, fallbackCompany: Company, id: string, at: Date, existing?: Application): Application {
  const product = productById(goalProduct(w.goalId));
  const base: Application = existing ?? {
    id,
    ownerUserId: user.id,
    company: w.company ?? fallbackCompany,
    goalId: w.goalId,
    productId: product.id,
    requested: { ...w.requested, rate: product.baseRate },
    indicativeRate: product.baseRate,
    status: 'DRAFT',
    createdAt: iso(at),
    updatedAt: iso(at),
    documents: [],
    docRequests: [],
    consents: { bki: false, personalData: false, authority: false },
    checks: [],
    messages: [],
    history: [],
    version: 1,
    changes: [],
  };
  const next: Application = {
    ...base,
    company: w.company ?? base.company,
    goalId: w.goalId,
    subgoalId: w.subgoalId,
    productId: product.id,
    requested: { ...w.requested, rate: product.baseRate },
    indicativeRate: product.baseRate,
    financials: w.financials ?? undefined,
    documents: w.documents,
    consents: w.consents,
    contactPerson: w.contactPerson,
    draftStep: w.step,
    updatedAt: iso(at),
  };
  return existing ? next : withEvent(next, at, actorOf(user), 'draft_saved', 'Черновик сохранён', { visibleToClient: true });
}

const goalProduct = (goalId: string) => goalById(goalId).productId;

/* ---------- Отправка и авто-проверки ---------- */

export const PIPELINE_TITLES: Record<PipelineStepId, string> = {
  registry: 'Сверяем реквизиты в ЕГРЮЛ',
  bki: 'Запрашиваем кредитную историю',
  statement: 'Анализируем выписку',
  scoring: 'Оцениваем заявку',
  decision: 'Определяем, кто примет решение',
};

const STEP_IDS: PipelineStepId[] = ['registry', 'bki', 'statement', 'scoring', 'decision'];

/** Пауза между шагами: 5 шагов укладываются в 2–4 секунды */
export const stepDelay = () => 450 + Math.round(Math.random() * 200);

const freshPipeline = (at: Date) => ({
  steps: STEP_IDS.map((id): PipelineStep => ({ id, title: PIPELINE_TITLES[id], status: 'pending' })),
  nextAt: iso(new Date(at.getTime() + 500)),
});

export function submit(app: Application, at: Date, actor: Actor): Application {
  if (!app.consents.bki || !app.consents.personalData || !app.consents.authority) {
    throw new Error('Нужны все три согласия, чтобы отправить заявку');
  }
  const next = moveTo(app, 'SUBMITTED', at);
  return withEvent(
    { ...next, submittedAt: iso(at), consents: { ...app.consents, at: iso(at) }, draftStep: undefined, pipeline: freshPipeline(at) },
    at,
    actor,
    'submitted',
    'Заявка поступила',
    { clientText: 'Заявка отправлена' },
  );
}

function restartChecks(app: Application, at: Date, actor: Actor, reason: string): Application {
  const next = moveTo(app, 'AUTO_CHECKS', at);
  return withEvent({ ...next, pipeline: freshPipeline(at) }, at, actor, 'auto_restarted', `Повторные авто-проверки: ${reason}`, {
    clientText: 'Данные изменились — проверяем заявку заново',
  });
}

function registryChecks(company: Company, fromRegistry: Company, at: Date): CheckResult[] {
  const age = monthsBetween(new Date(fromRegistry.registeredAt), at);
  const registry: CheckResult = {
    id: 'registry',
    title: 'ЕГРЮЛ / ЕГРИП',
    status: fromRegistry.status === 'liquidated' ? 'fail' : age < MIN_BUSINESS_AGE_MONTHS ? 'warn' : 'ok',
    details: [
      `Статус: ${fromRegistry.status === 'active' ? 'действующая' : 'ликвидирована'}`,
      `Дата регистрации: ${fullDate(fromRegistry.registeredAt)} (${businessAge(age)})`,
      `ОКВЭД ${fromRegistry.okved} — ${fromRegistry.okvedName}`,
    ],
  };
  const innOk = isValidInn(company.inn);
  const ogrnOk = isValidRegistrationNumber(company.ogrn, company.form);
  const matches = company.ogrn === fromRegistry.ogrn && company.name === fromRegistry.name;
  const requisites: CheckResult = {
    id: 'requisites',
    title: 'Реквизиты',
    status: innOk && ogrnOk && matches ? 'ok' : 'fail',
    details: [
      innOk ? 'ИНН: контрольное число сходится' : 'ИНН: контрольное число не сходится',
      ogrnOk ? `${company.form === 'ИП' ? 'ОГРНИП' : 'ОГРН'}: контрольное число сходится` : 'ОГРН: контрольное число не сходится',
      matches ? 'Название и ОГРН совпадают с реестром' : 'Данные заявки расходятся с реестром',
    ],
  };
  return [registry, requisites];
}

export function documentsCheck(app: Application, product: Product = productOf(app)): CheckResult {
  const missing = missingDocs(product, app.documents);
  return {
    id: 'documents',
    title: 'Комплектность документов',
    status: missing.length ? 'warn' : 'ok',
    details: product.requiredDocs.map((t) => `${DOC_TYPES[t].title}: ${missing.includes(t) ? 'нет' : 'есть'}`),
  };
}

const setCheck = (checks: CheckResult[], c: CheckResult) => [...checks.filter((x) => x.id !== c.id), c];

function completeStep(app: Application, id: PipelineStepId, at: Date, status: 'done' | 'fail' = 'done'): Application {
  if (!app.pipeline) return app;
  return {
    ...app,
    pipeline: {
      ...app.pipeline,
      steps: app.pipeline.steps.map((s) => (s.id === id ? { ...s, status, doneAt: iso(at) } : s)),
      nextAt: iso(new Date(at.getTime() + stepDelay())),
    },
  };
}

/** Один шаг авто-проверок. Возвращает заявку без изменений, если делать нечего. */
export function pipelineTick(app: Application, at: Date): Application {
  if (app.status === 'SUBMITTED') {
    const next = moveTo(app, 'AUTO_CHECKS', at);
    return withEvent(next, at, SYSTEM, 'auto_started', 'Начаты автоматические проверки');
  }
  if (app.status !== 'AUTO_CHECKS' || !app.pipeline) return app;
  const step = app.pipeline.steps.find((s) => s.status === 'pending');
  if (!step) return app;

  switch (step.id) {
    case 'registry': {
      const fromRegistry = lookupCompany(app.company.inn, at);
      const checks = registryChecks(app.company, fromRegistry, at).reduce(setCheck, app.checks);
      const ok = fromRegistry.status === 'active';
      const next = completeStep({ ...app, company: { ...app.company, status: fromRegistry.status }, checks }, 'registry', at, ok ? 'done' : 'fail');
      return withEvent(
        next,
        at,
        SYSTEM,
        'registry',
        ok ? 'Реквизиты подтверждены в ЕГРЮЛ' : 'По данным ЕГРЮЛ компания ликвидирована',
      );
    }
    case 'bki': {
      const r = bkiReport(app.company.inn);
      const prev = app.financials;
      const financials: Financials = {
        ...(prev ?? emptyFinancials()),
        existingLoans: r.loans,
        existingDebt: prev?.existingDebt ?? r.totalDebt,
        existingMonthlyPayments: prev?.existingMonthlyPayments ?? r.monthlyPayments,
        overdueCurrent: r.overdueCurrent,
        overdueClosed12m: r.overdueClosed12m,
      };
      const check: CheckResult = {
        id: 'bki',
        title: 'Кредитная история (БКИ)',
        status: r.overdueCurrent ? 'fail' : r.overdueClosed12m ? 'warn' : 'ok',
        details: [
          `Действующих кредитов: ${r.loans}, долг ${rub(r.totalDebt)}`,
          `Платежи по ним: ${rub(r.monthlyPayments)} в месяц`,
          r.overdueCurrent ? 'Есть текущая просрочка' : 'Текущих просрочек нет',
          `Закрытых просрочек за 12 мес: ${r.overdueClosed12m}`,
        ],
      };
      const next = completeStep({ ...app, financials, checks: setCheck(app.checks, check) }, 'bki', at, r.overdueCurrent ? 'fail' : 'done');
      return withEvent(next, at, SYSTEM, 'bki', 'Получена кредитная история');
    }
    case 'statement': {
      const f = app.financials ?? emptyFinancials();
      const financials = f.turnoverByMonth.length ? f : { ...f, ...statementFinancials(app.company.inn) };
      const next = completeStep({ ...app, financials }, 'statement', at);
      return withEvent(next, at, SYSTEM, 'statement', `Проанализирована выписка: средний оборот за 3 мес — ${rub(financials.avgTurnover3m)}`, {
        clientText: 'Проанализирована выписка',
      });
    }
    case 'scoring': {
      const scoring = score({ company: app.company, financials: app.financials!, terms: app.requested, now: at });
      const next = completeStep({ ...app, scoring, checks: setCheck(app.checks, documentsCheck(app)) }, 'scoring', at);
      return withEvent(next, at, SYSTEM, 'scoring', `Скоринг: ${scoring.score} баллов`, { visibleToClient: false });
    }
    case 'decision':
      return applyPolicy(completeStep(app, 'decision', at), at);
  }
}

function applyPolicy(app: Application, at: Date): Application {
  const product = productOf(app);
  const result = decide({ product, requested: app.requested, scoring: app.scoring!, documents: app.documents, financials: app.financials! });
  const s = app.scoring!;
  const base = { ...app, recommendation: result.recommendation, pipeline: app.pipeline && { ...app.pipeline, owner: undefined } };

  if (result.outcome === 'REJECTED') {
    const reason = rejectReason(result.reasonCode);
    const next = moveTo(base, 'REJECTED', at);
    const withDecision: Application = {
      ...next,
      decision: {
        type: 'reject',
        reasonCode: reason.code,
        justification: `Стоп-фактор: ${s.stopFactors.map((x) => x.text.toLowerCase()).join('; ')}`,
        clientMessage: reason.clientMessage,
        decidedBy: 'system',
        decidedAt: iso(at),
      },
    };
    return withEvent(withDecision, at, SYSTEM, 'decision', `Авто-отказ: ${s.stopFactors[0].text.toLowerCase()}`, {
      clientText: 'Решение: отказ',
    });
  }

  if (result.outcome === 'APPROVED') {
    const next = moveTo(base, 'APPROVED', at);
    const withDecision: Application = {
      ...next,
      decision: {
        type: 'approve',
        terms: result.terms,
        justification: `Авто-одобрение: ${s.score} баллов, сумма в пределах авто-лимита, документы в комплекте.`,
        clientMessage: 'Заявка одобрена автоматически. Проверьте условия и подтвердите их.',
        decidedBy: 'system',
        decidedAt: iso(at),
        validUntil: iso(addDays(at, OFFER_VALID_DAYS)),
      },
    };
    const ev = withEvent(withDecision, at, SYSTEM, 'auto_result', `Авто-проверки: ${s.score} баллов, авто-одобрение`, { visibleToClient: false });
    return withEvent(ev, at, SYSTEM, 'decision', 'Решение системы: одобрено', { clientText: 'Заявка одобрена' });
  }

  const next = moveTo(base, 'IN_QUEUE', at);
  const queued = { ...next, slaDueAt: next.slaDueAt ?? iso(addBusinessDays(at, SLA_BUSINESS_DAYS)) };
  const ev = withEvent(
    queued,
    at,
    SYSTEM,
    'auto_result',
    `Авто-проверки: ${s.score} баллов, ручная проверка (${result.recommendation.manualReasons.join('; ').toLowerCase()})`,
    { visibleToClient: false },
  );
  return withEvent(ev, at, SYSTEM, 'queued', 'Заявка передана специалисту', { clientText: 'Заявку проверит специалист' });
}

/** Прогнать все шаги сразу — для сида. */
export function runPipelineSync(app: Application, at: Date): Application {
  let cur = app;
  let t = at.getTime();
  for (let i = 0; i < 10 && (cur.status === 'SUBMITTED' || cur.status === 'AUTO_CHECKS'); i++) {
    t += 600;
    cur = pipelineTick(cur, new Date(t));
  }
  return cur;
}

export const emptyFinancials = (): Financials => ({
  revenue12m: 0,
  avgTurnover12m: 0,
  avgTurnover3m: 0,
  turnoverByMonth: [],
  existingDebt: 0,
  existingMonthlyPayments: 0,
  existingLoans: 0,
  overdueCurrent: false,
  overdueClosed12m: 0,
});

export function statementFinancials(inn: string) {
  const s = analyzeStatement(inn);
  return { revenue12m: s.revenue12m, avgTurnover12m: s.avgTurnover12m, avgTurnover3m: s.avgTurnover3m, turnoverByMonth: s.turnoverByMonth };
}

/** Финансы для мастера: выписка + БКИ (клиент может поправить выручку и долги) */
export function prefillFinancials(inn: string): Financials {
  const r = bkiReport(inn);
  return {
    ...emptyFinancials(),
    ...statementFinancials(inn),
    existingDebt: r.totalDebt,
    existingMonthlyPayments: r.monthlyPayments,
    existingLoans: r.loans,
    overdueCurrent: r.overdueCurrent,
    overdueClosed12m: r.overdueClosed12m,
  };
}

/* ---------- Работа сотрудника ---------- */

export function takeToWork(app: Application, employee: Actor, at: Date): Application {
  if (!employee.id) throw new Error('Не указан сотрудник');
  const next = moveTo(app, 'IN_REVIEW', at);
  return withEvent({ ...next, assigneeId: employee.id, assignedAt: iso(at) }, at, employee, 'taken', `Заявка взята в работу: ${employee.name}`, {
    clientText: 'Заявку взял в работу специалист',
  });
}

export interface RequestItem {
  docType: DocType;
  comment: string;
}

export function requestDocuments(app: Application, employee: Actor, items: RequestItem[], dueAt: Date, at: Date): Application {
  if (!items.length) throw new Error('Выберите хотя бы один документ');
  const next = moveTo(app, 'NEED_INFO', at);
  const requests = items.map((i) => ({
    id: uid('req'),
    docType: i.docType,
    comment: i.comment.trim(),
    dueAt: iso(dueAt),
    createdAt: iso(at),
    createdBy: employee.name,
    seenByClient: false,
  }));
  const titles = items.map((i) => DOC_TYPES[i.docType].title.toLowerCase()).join(', ');
  return withEvent({ ...next, docRequests: [...app.docRequests, ...requests] }, at, employee, 'docs_requested', `Запрошены документы: ${titles}`, {
    clientText: `Специалист запросил документы: ${titles}`,
  });
}

export interface DecisionInput {
  type: 'approve' | 'counter_offer';
  terms: Terms;
  validDays: number;
  justification: string;
  clientMessage: string;
}

export function validateTerms(product: Product, t: Terms): string | null {
  if (t.amount < product.minAmount || t.amount > product.maxAmount) return `Сумма должна быть от ${rub(product.minAmount)} до ${rub(product.maxAmount)}`;
  if (t.term < product.minTerm || t.term > product.maxTerm) return `Срок должен быть от ${product.minTerm} до ${product.maxTerm} мес.`;
  if (!product.paymentTypes.includes(t.paymentType)) return 'Этот тип платежа недоступен для продукта';
  if (t.rate <= 0 || t.rate > 60) return 'Проверьте ставку';
  if (t.paymentType === 'annuity_grace' && ((t.graceMonths ?? 0) < 1 || (t.graceMonths ?? 0) > (product.maxGraceMonths ?? 0))) {
    return `Отсрочка — от 1 до ${product.maxGraceMonths} мес.`;
  }
  return null;
}

export function makeDecision(app: Application, employee: Actor, input: DecisionInput, at: Date): Application {
  if (input.justification.trim().length < 20) throw new Error('Обоснование — не меньше 20 символов');
  const invalid = validateTerms(productOf(app), input.terms);
  if (invalid) throw new Error(invalid);
  const to = input.type === 'approve' ? 'APPROVED' : 'COUNTER_OFFER';
  const next = moveTo(app, to, at);
  const withDecision: Application = {
    ...next,
    decision: {
      type: input.type,
      terms: input.terms,
      justification: input.justification.trim(),
      clientMessage:
        input.clientMessage.trim() ||
        (input.type === 'approve' ? 'Заявка одобрена. Проверьте условия и подтвердите их.' : 'Мы можем выдать кредит на других условиях — посмотрите предложение.'),
      decidedBy: employee.name,
      decidedById: employee.id,
      decidedAt: iso(at),
      validUntil: iso(addDays(at, input.validDays)),
    },
  };
  const t = input.terms;
  const summary = `${rub(t.amount)}, ${months(t.term)}, ${t.rate}%`;
  return withEvent(
    withDecision,
    at,
    employee,
    'decision',
    input.type === 'approve' ? `Решение: одобрено (${summary})` : `Решение: встречное предложение (${summary})`,
    { clientText: input.type === 'approve' ? 'Заявка одобрена' : 'Банк предложил другие условия' },
  );
}

export interface RejectInput {
  reasonCode: string;
  justification: string;
  clientMessage: string;
}

export function rejectApplication(app: Application, employee: Actor, input: RejectInput, at: Date): Application {
  if (input.justification.trim().length < 20) throw new Error('Обоснование — не меньше 20 символов');
  if (!input.clientMessage.trim()) throw new Error('Напишите сообщение клиенту');
  const reason = rejectReason(input.reasonCode);
  const next = moveTo(app, 'REJECTED', at);
  return withEvent(
    {
      ...next,
      decision: {
        type: 'reject',
        reasonCode: reason.code,
        justification: input.justification.trim(),
        clientMessage: input.clientMessage.trim(),
        decidedBy: employee.name,
        decidedById: employee.id,
        decidedAt: iso(at),
      },
    },
    at,
    employee,
    'decision',
    `Решение: отказ — ${reason.title.toLowerCase()}`,
    { clientText: 'Решение: отказ' },
  );
}

export function acknowledgeChanges(app: Application, employee: Actor, at: Date): Application {
  return withEvent({ ...app, changedSinceReview: false }, at, employee, 'changes_ack', 'Сотрудник ознакомился с изменениями', { visibleToClient: false });
}

export function rescore(app: Application, at: Date, actor: Actor = SYSTEM): Application {
  if (!app.financials) return app;
  const before = app.scoring?.score;
  const scoring = score({ company: app.company, financials: app.financials, terms: app.requested, now: at });
  const recommendation = recommend({ product: productOf(app), requested: app.requested, scoring, documents: app.documents, financials: app.financials });
  return withEvent(
    { ...app, scoring, recommendation, checks: setCheck(app.checks, documentsCheck(app)) },
    at,
    actor,
    'rescored',
    before === undefined ? `Скоринг: ${scoring.score} баллов` : `Скоринг пересчитан: ${scoring.score} баллов (было ${before})`,
    { visibleToClient: false },
  );
}

/* ---------- Действия клиента ---------- */

/** Загрузка документов. requestId — закрыть конкретный запрос (только документом его типа). */
export function addDocuments(app: Application, client: Actor, files: Omit<DocFile, 'source' | 'addedBy'>[], at: Date, requestId?: string): Application {
  if (!files.length) return app;
  if (!isEditable(app.status)) throw new Error('Сейчас документы к заявке добавить нельзя');
  let requests = app.docRequests;
  const added: DocFile[] = [];
  for (const f of files) {
    let target = requestId ? requests.find((r) => r.id === requestId) : requests.find((r) => !r.fulfilledByDocId && r.docType === f.docType);
    if (requestId) {
      if (!target || target.fulfilledByDocId) throw new Error('Запрос уже закрыт');
      if (target.docType !== f.docType) throw new Error(`Этот запрос закрывается только документом «${DOC_TYPES[target.docType].title}»`);
    }
    const doc: DocFile = { ...f, addedBy: 'client', source: target ? 'request' : 'later' };
    added.push(doc);
    if (target) {
      const id = target.id;
      requests = requests.map((r) => (r.id === id ? { ...r, fulfilledByDocId: doc.id, fulfilledAt: iso(at) } : r));
      target = undefined;
    }
  }
  let next: Application = { ...app, documents: [...app.documents, ...added], docRequests: requests };
  next = { ...next, checks: setCheck(next.checks, documentsCheck(next)) };
  const names = added.map((d) => DOC_TYPES[d.docType].title.toLowerCase()).join(', ');
  next = withEvent(next, at, client, 'client_docs', `Клиент загрузил: ${names}`, { clientText: `Вы загрузили: ${names}` });

  if (next.status === 'NEED_INFO' && openRequests(next).length === 0) {
    next = moveTo(next, 'IN_REVIEW', at);
    next = withEvent({ ...next, newDocsForEmployee: true }, at, client, 'client_answered', 'Клиент ответил на все запросы — заявка снова у специалиста', {
      clientText: 'Все запрошенные документы получены — заявка снова у специалиста',
    });
  } else if (next.status === 'IN_REVIEW' || next.status === 'NEED_INFO') {
    next = { ...next, newDocsForEmployee: true };
  } else if (next.status === 'IN_QUEUE') {
    next = restartChecks(next, at, client, 'добавлены документы');
  }
  return next;
}

export function sendMessage(app: Application, author: Actor, text: string, at: Date): Application {
  if (!canMessage(app.status)) throw new Error('Переписка по этой заявке закрыта');
  if (author.role === 'system') throw new Error('Система не пишет сообщения');
  const body = text.trim();
  if (!body) return app;
  return {
    ...app,
    updatedAt: iso(at),
    messages: [
      ...app.messages,
      {
        id: uid('msg'),
        author: author.role,
        authorName: author.name,
        text: body,
        createdAt: iso(at),
        readByClient: author.role === 'client',
        readByEmployee: author.role === 'employee',
      },
    ],
  };
}

export function markSeen(app: Application, role: Role): Application {
  const messages = app.messages.map((m) => (role === 'client' ? { ...m, readByClient: true } : { ...m, readByEmployee: true }));
  const docRequests = role === 'client' ? app.docRequests.map((r) => ({ ...r, seenByClient: true })) : app.docRequests;
  return { ...app, messages, docRequests };
}

export interface ClientChanges {
  requested?: Partial<Pick<Terms, 'amount' | 'term' | 'paymentType' | 'graceMonths'>>;
  financials?: Partial<Pick<Financials, 'revenue12m' | 'existingDebt' | 'existingMonthlyPayments'>>;
}

const FIELD_LABEL: Record<string, string> = {
  amount: 'сумму',
  term: 'срок',
  paymentType: 'тип платежа',
  graceMonths: 'отсрочку',
  revenue12m: 'выручку за 12 мес',
  existingDebt: 'долг по действующим кредитам',
  existingMonthlyPayments: 'платежи по действующим кредитам',
};

function fmtField(field: string, v: unknown) {
  if (v === undefined || v === null) return '—';
  if (field === 'term') return months(Number(v));
  if (field === 'graceMonths') return `${v} мес.`;
  if (field === 'paymentType') return PAYMENT_TYPE_LABEL[v as Terms['paymentType']];
  return field === 'amount' || field === 'revenue12m' || field === 'existingDebt' || field === 'existingMonthlyPayments'
    ? rub(Number(v))
    : String(v);
}

/** Клиент меняет данные после отправки (правила — §10.9 задачи). */
export function updateByClient(app: Application, client: Actor, patch: ClientChanges, at: Date): Application {
  if (!isEditable(app.status)) throw new Error('Сейчас условия заявки изменить нельзя');
  const product = productOf(app);
  const requested: Terms = { ...app.requested, ...patch.requested };
  if (requested.paymentType !== 'annuity_grace') delete requested.graceMonths;
  const invalid = validateTerms(product, requested);
  if (invalid) throw new Error(invalid);
  const financials = app.financials ? { ...app.financials, ...patch.financials } : app.financials;

  const diffs: { field: string; from: string; to: string }[] = [];
  for (const k of ['amount', 'term', 'paymentType', 'graceMonths'] as const) {
    if (app.requested[k] !== requested[k]) diffs.push({ field: k, from: fmtField(k, app.requested[k]), to: fmtField(k, requested[k]) });
  }
  if (app.financials && financials) {
    for (const k of ['revenue12m', 'existingDebt', 'existingMonthlyPayments'] as const) {
      if (app.financials[k] !== financials[k]) diffs.push({ field: k, from: fmtField(k, app.financials[k]), to: fmtField(k, financials[k]) });
    }
  }
  if (!diffs.length) return app;

  const version = app.version + 1;
  const text = diffs.map((d) => `${FIELD_LABEL[d.field]}: ${d.from} → ${d.to}`).join('; ');
  let next: Application = {
    ...app,
    requested,
    financials,
    version,
    changes: [...app.changes, ...diffs.map((d) => ({ version, at: iso(at), ...d }))],
  };
  next = withEvent(next, at, client, 'client_changed', `Клиент изменил ${text}`, { clientText: `Вы изменили ${text}` });

  if (next.status === 'IN_QUEUE') return restartChecks(next, at, client, 'клиент изменил данные');

  next = rescore({ ...next, changedSinceReview: true }, at);
  return sendMessage(next, client, `Изменены данные заявки: ${text}. Скоринг пересчитан.`, at);
}

export function acceptOffer(app: Application, client: Actor, at: Date): Application {
  const next = moveTo(app, 'SIGNING', at);
  return withEvent(next, at, client, 'client_accepted', 'Клиент принял условия', { clientText: 'Вы приняли условия' });
}

export function declineOffer(app: Application, client: Actor, reason: string, at: Date): Application {
  const next = moveTo(app, 'DECLINED_BY_CLIENT', at);
  return withEvent(
    { ...next, declineReason: reason.trim() || undefined },
    at,
    client,
    'client_declined',
    `Клиент отказался от предложения${reason.trim() ? `: ${reason.trim()}` : ''}`,
    { clientText: 'Вы отказались от предложения' },
  );
}

export function signDocuments(app: Application, client: Actor, at: Date): Application {
  if (app.status !== 'SIGNING') throw new Error('Подписание недоступно в этом статусе');
  if (app.signedAt) return app;
  return withEvent({ ...app, signedAt: iso(at) }, at, client, 'signed', 'Клиент подписал документы (симуляция)', {
    clientText: 'Документы подписаны (симуляция)',
  });
}

export function issue(app: Application, client: Actor, accountNumber: string, at: Date): Application {
  if (!app.signedAt) throw new Error('Сначала подпишите документы');
  const next = moveTo(app, 'ISSUED', at);
  return withEvent(
    { ...next, issued: { accountNumber, issuedAt: iso(at) } },
    at,
    client,
    'issued',
    `Кредит выдан: ${rub(finalTerms(app).amount)} на счёт ${maskAccount(accountNumber)}`,
    { clientText: `Кредит выдан: деньги зачислены на счёт ${maskAccount(accountNumber)}` },
  );
}

export const maskAccount = (n: string) => `•• ${n.slice(-4)}`;

export function withdraw(app: Application, client: Actor, at: Date): Application {
  const next = moveTo(app, 'WITHDRAWN', at);
  return withEvent(next, at, client, 'withdrawn', 'Заявка отозвана клиентом', { clientText: 'Вы отозвали заявку' });
}

export const describeTerms = (t: Terms) =>
  `${rub(t.amount)} на ${months(t.term)}, ${t.rate}% · ${PAYMENT_TYPE_LABEL[t.paymentType]}${t.graceMonths ? ` (${t.graceMonths} мес.)` : ''}`;

