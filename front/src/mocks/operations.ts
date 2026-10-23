import type {
  Application,
  AppStatus,
  CheckResult,
  Company,
  DecisionDraft,
  DocFile,
  DocType,
  Financials,
  HistoryEvent,
  Metrics,
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
import { MIN_BUSINESS_AGE_MONTHS, OFFER_VALID_DAYS, SLA_BUSINESS_DAYS, DOC_REQUEST_DAYS, goalById, productById, rateBounds, type Product } from '../config/products.ts';
import { POLICY } from '../config/policy.ts';
import { rejectReason } from '../config/rejectReasons.ts';
import { DECISION_REASONS, WAIVER_REASONS, codeInfo } from '../config/routeCodes.ts';
import { businessAge, fullDate, months, percent, rub } from '../utils/format.ts';
import { lookupCompany } from './registry.ts';
import { bkiReport, historyOf } from './bki.ts';
import { analyzeStatement } from './statement.ts';
import { checkSources } from './sources.ts';
import { score } from './scoring.ts';
import { computeMetrics } from './affordability.ts';
import { computeRoute, lastFullMonth, validate, type RouteResult } from './creditPolicy.ts';

/**
 * Операции над заявкой — чистые функции (app, …, at) → app.
 * Их вызывают и мок-API, и сид, поэтому сид согласован с моделью.
 * Каждое изменение статуса проходит через assertTransition и пишет событие в историю.
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
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2).replace('.', ','));

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

const goalProduct = (goalId: string) => goalById(goalId).productId;

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

/* ---------- Отправка и авто-проверки ---------- */

export const PIPELINE_TITLES: Record<PipelineStepId, string> = {
  registry: 'Сверяем реквизиты в ЕГРЮЛ',
  bki: 'Запрашиваем кредитную историю',
  statement: 'Анализируем выписку',
  sources: 'Проверяем Федресурс, ФССП и ФНС',
  affordability: 'Считаем платёжеспособность',
  scoring: 'Оцениваем по скоринговой карте',
  decision: 'Определяем маршрут заявки',
};

const STEP_IDS: PipelineStepId[] = ['registry', 'bki', 'statement', 'sources', 'affordability', 'scoring', 'decision'];

/** Пауза между шагами: 7 шагов укладываются в 2–4 секунды */
export const stepDelay = () => 320 + Math.round(Math.random() * 160);

const freshPipeline = (at: Date) => ({
  steps: STEP_IDS.map((id): PipelineStep => ({ id, title: PIPELINE_TITLES[id], status: 'pending' })),
  nextAt: iso(new Date(at.getTime() + 400)),
});

export function submit(app: Application, at: Date, actor: Actor): Application {
  const invalid = validate(app, productOf(app));
  if (Object.keys(invalid).length) {
    throw new Error(`Заявку нельзя отправить: ${Object.entries(invalid).map(([c, d]) => `${c} — ${d}`).join('; ')}`);
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
  return withEvent({ ...next, pendingDecision: undefined, pipeline: freshPipeline(at) }, at, actor, 'auto_restarted', `Повторные авто-проверки: ${reason}`, {
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
  const missing = product.requiredDocs.filter((t) => !app.documents.some((d) => d.docType === t));
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

/* ---------- Оценка: метрики → скоринг → маршрут ---------- */

export interface Assessment {
  metrics: Metrics;
  result: RouteResult;
  app: Application;
}

/** Полная оценка заявки на текущих данных. Статус не меняет. */
export function assess(app: Application, at: Date): Assessment {
  const product = productOf(app);
  const metrics = computeMetrics(app.financials!, app.requested, product, at);
  const scoring = score({ company: app.company, sources: app.sources!, history: app.creditHistory!, trend: metrics.trend, cf: metrics.cf, now: at });
  const result = computeRoute({ app, product, scoring, metrics, now: at });
  return {
    metrics,
    result,
    app: {
      ...app,
      metrics,
      scoring,
      route: result.route,
      trace: result.trace,
      recommendation: result.recommendation,
      checks: setCheck(app.checks, documentsCheck(app, product)),
    },
  };
}

/** Пересчёт на месте (клиент изменил данные, снят мягкий стоп, сотрудник нажал «Пересчитать»). */
export function reassess(app: Application, at: Date, actor: Actor = SYSTEM, reason = 'пересчёт'): Application {
  if (!app.financials || !app.sources || !app.creditHistory) return app;
  const before = app.scoring;
  const { app: next } = assess(app, at);
  const s = next.scoring!;
  const m = next.metrics!;
  const delta = before && before.score !== s.score ? ` (было ${before.score})` : '';
  return withEvent(
    next,
    at,
    actor,
    'rescored',
    `Пересчёт (${reason}): ${s.score} баллов${delta}, группа ${s.grade}, DSCR ${f2(m.dscr)}, стресс ${f2(m.dscrStress)}. ${next.route!.summary}`,
    { visibleToClient: false },
  );
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
      return withEvent(next, at, SYSTEM, 'registry', ok ? 'Реквизиты подтверждены в ЕГРЮЛ' : 'По данным ЕГРЮЛ компания ликвидирована');
    }
    case 'bki': {
      const r = bkiReport(app.company.inn);
      const prev = app.financials;
      const financials: Financials = {
        ...(prev ?? emptyFinancials()),
        existingLoans: r.loans,
        bkiDebt: r.totalDebt,
        // если клиент уточнил долги в анкете — берём его цифры, расхождение проверит правило D09
        existingDebt: prev?.existingDebt ?? r.totalDebt,
        existingMonthlyPayments: prev?.existingMonthlyPayments ?? r.monthlyPayments,
        overdueCurrent: r.currentOverdueDays > 0,
        overdueClosed12m: r.worstClosed24m === 'none' ? 0 : 1,
      };
      const overdueText = { none: 'нет', '1_29': '1–29 дней', '30_90': '30–90 дней', over_90: 'больше 90 дней' } as const;
      const check: CheckResult = {
        id: 'bki',
        title: 'Кредитная история (БКИ)',
        status: r.currentOverdueDays > POLICY.H09_OVERDUE_DAYS ? 'fail' : r.worstClosed24m !== 'none' || r.currentOverdueDays > 0 ? 'warn' : 'ok',
        details: [
          `Действующих кредитов: ${r.loans}, долг ${rub(r.totalDebt)}`,
          `Платежи по ним: ${rub(r.monthlyPayments)} в месяц`,
          r.currentOverdueDays ? `Текущая просрочка: ${r.currentOverdueDays} дн.` : 'Текущих просрочек нет',
          `Худшая закрытая просрочка за 24 мес.: ${overdueText[r.worstClosed24m]}`,
          `Руководитель: ${r.director.hasHistory ? `история есть, просрочки — ${overdueText[r.director.worstClosed24m]}` : 'истории нет'}`,
        ],
      };
      const next = completeStep({ ...app, financials, creditHistory: historyOf(r), checks: setCheck(app.checks, check) }, 'bki', at, check.status === 'fail' ? 'fail' : 'done');
      return withEvent(next, at, SYSTEM, 'bki', 'Получена кредитная история');
    }
    case 'statement': {
      const f = app.financials ?? emptyFinancials();
      const financials: Financials = f.revenueByMonth.length ? f : { ...f, ...statementFinancials(app.company.inn) };
      const next = completeStep({ ...app, financials }, 'statement', at);
      return withEvent(next, at, SYSTEM, 'statement', `Проанализирована выписка: выручка за 12 мес. — ${rub(financials.revenue12m)}`, {
        clientText: 'Проанализирована выписка',
      });
    }
    case 'sources': {
      const sources = checkSources(app.company, app.financials?.revenue12m ?? 0, at);
      const flags = [
        sources.bankruptcy && 'банкротство (Федресурс)',
        sources.sanctions && 'перечни',
        sources.zskRisk !== 'low' && `ЗСК ЦБ: ${sources.zskRisk === 'high' ? 'высокий' : 'средний'} риск`,
        sources.directorDisqualified && 'дисквалификация руководителя',
        sources.fnsBlocked && 'блокировка счетов ФНС',
        sources.unreliableData && 'недостоверные сведения',
      ].filter(Boolean) as string[];
      const check: CheckResult = {
        id: 'sources',
        title: 'Внешние источники',
        status: flags.length ? 'fail' : sources.taxDebt + sources.fsspDebt + sources.lawsuits > 0 ? 'warn' : 'ok',
        details: [
          flags.length ? `Найдено: ${flags.join(', ')}` : 'Федресурс, перечни, ЗСК, дисквалификации, ФНС — без замечаний',
          `Налоги: ${sources.taxDiscipline === 'regular' ? 'платятся регулярно' : 'были задержки'}${sources.taxDebt ? `, долг ${rub(sources.taxDebt)}` : ''}`,
          `ФССП: ${sources.fsspDebt ? rub(sources.fsspDebt) : 'нет'} · иски: ${sources.lawsuits ? rub(sources.lawsuits) : 'нет'}`,
        ],
      };
      const next = completeStep({ ...app, sources, checks: setCheck(app.checks, check) }, 'sources', at, flags.length ? 'fail' : 'done');
      return withEvent(next, at, SYSTEM, 'sources', 'Проверены внешние источники');
    }
    case 'affordability': {
      const metrics = computeMetrics(app.financials!, app.requested, productOf(app), at);
      const next = completeStep({ ...app, metrics }, 'affordability', at, metrics.cfNegative ? 'fail' : 'done');
      return withEvent(
        next,
        at,
        SYSTEM,
        'affordability',
        `Платёжеспособность: DSCR ${f2(metrics.dscr)}, стресс ${f2(metrics.dscrStress)}, долг/CF ${f2(metrics.debtCf)}`,
        { visibleToClient: false },
      );
    }
    case 'scoring': {
      const m = app.metrics!;
      const scoring = score({ company: app.company, sources: app.sources!, history: app.creditHistory!, trend: m.trend, cf: m.cf, now: at });
      const next = completeStep({ ...app, scoring }, 'scoring', at);
      return withEvent(next, at, SYSTEM, 'scoring', `Скоринг: ${scoring.score} баллов, группа ${scoring.grade}, PD ${percent(scoring.pd, 2)}`, { visibleToClient: false });
    }
    case 'decision':
      return applyRoute(completeStep(app, 'decision', at), at);
  }
}

/** Применить маршрут авто-проверок: решение системы, запрос сведений или очередь. */
function applyRoute(app: Application, at: Date): Application {
  const { app: assessed, result } = assess(app, at);
  const { route } = result;
  let next: Application = { ...assessed, pipeline: assessed.pipeline && { ...assessed.pipeline, owner: undefined } };
  next = withEvent(next, at, SYSTEM, 'auto_result', `Авто-проверки: ${next.scoring!.score} баллов, группа ${next.scoring!.grade}. ${route.summary}`, {
    visibleToClient: false,
  });

  // Сотрудник уже работал с заявкой: система пересчитывает и возвращает её ему, а не решает сама
  if (next.assigneeId && route.status !== 'NEED_INFO') {
    next = moveTo(next, 'IN_QUEUE', at);
    next = moveTo(next, 'IN_REVIEW', at);
    return withEvent({ ...next, newDocsForEmployee: true }, at, SYSTEM, 'client_answered', 'Проверки повторены — заявка снова у специалиста', {
      clientText: 'Все сведения получены — заявка снова у специалиста',
    });
  }

  switch (route.status) {
    case 'REJECTED': {
      next = moveTo(next, 'REJECTED', at);
      next = {
        ...next,
        decision: {
          type: 'reject',
          reasonCode: route.primaryCode,
          routeCodes: route.allCodes,
          justification: `Авто-отказ: ${route.summary}`,
          clientMessage: result.clientRejectText ?? 'Банк не может выдать кредит на этих условиях.',
          decidedBy: 'system',
          decidedAt: iso(at),
        },
      };
      return withEvent(next, at, SYSTEM, 'decision', `Решение системы: отказ (${route.allCodes.filter((c) => /^[HF]|S01X/.test(c)).join(', ')})`, {
        clientText: 'Решение: отказ',
      });
    }
    case 'NEED_INFO': {
      const cycle = (next.needInfoCycle ?? 0) + 1;
      const dueAt = iso(addBusinessDays(at, DOC_REQUEST_DAYS));
      const requests = result.requests.map((r) => ({
        id: uid('req'),
        docType: r.docType,
        comment: r.comment,
        reasonCode: r.reasonCode,
        cycle,
        dueAt,
        createdAt: iso(at),
        createdBy: 'Система',
        seenByClient: false,
      }));
      next = moveTo({ ...next, needInfoCycle: cycle, docRequests: [...next.docRequests, ...requests] }, 'NEED_INFO', at);
      const titles = requests.map((r) => DOC_TYPES[r.docType].title.toLowerCase()).join(', ');
      return withEvent(next, at, SYSTEM, 'docs_requested', `Система запросила сведения (${requests.map((r) => r.reasonCode).join(', ')}): ${titles}`, {
        clientText: `Нужны документы: ${titles}`,
      });
    }
    case 'COUNTER_OFFER': {
      const terms = result.terms!;
      next = moveTo(next, 'COUNTER_OFFER', at);
      next = {
        ...next,
        decision: {
          type: 'counter_offer',
          variant: 'counter',
          terms,
          routeCodes: route.allCodes,
          justification: `Авто-контрпредложение: ${route.summary}. Подобран ближайший вариант, где выполняются все условия.`,
          clientMessage: `Запрошенный платёж слишком высок для текущих оборотов. Можем выдать ${rub(terms.amount)} на ${months(terms.term)} — так платёж будет посильным.`,
          decidedBy: 'system',
          decidedAt: iso(at),
          validUntil: iso(addDays(at, OFFER_VALID_DAYS)),
        },
      };
      return withEvent(next, at, SYSTEM, 'decision', `Решение системы: контрпредложение ${rub(terms.amount)} / ${months(terms.term)}`, {
        clientText: 'Банк предложил другие условия',
      });
    }
    case 'APPROVED': {
      const terms = result.terms!;
      next = moveTo(next, 'APPROVED', at);
      next = {
        ...next,
        decision: {
          type: 'approve',
          variant: 'as_requested',
          terms,
          routeCodes: [],
          justification: `Авто-одобрение: группа ${next.scoring!.grade}, DSCR ${f2(next.metrics!.dscr)}, стресс ${f2(next.metrics!.dscrStress)}, долг/CF ${f2(next.metrics!.debtCf)}.`,
          clientMessage: 'Заявка одобрена автоматически. Проверьте условия и подтвердите их.',
          decidedBy: 'system',
          decidedAt: iso(at),
          validUntil: iso(addDays(at, OFFER_VALID_DAYS)),
        },
      };
      return withEvent(next, at, SYSTEM, 'decision', 'Решение системы: одобрено', { clientText: 'Заявка одобрена' });
    }
    default: {
      // IN_QUEUE (и DRAFT на случай непредвиденной ошибки валидации) — к специалисту
      next = moveTo(next, 'IN_QUEUE', at);
      next = { ...next, slaDueAt: next.slaDueAt ?? iso(addBusinessDays(at, SLA_BUSINESS_DAYS)) };
      return withEvent(next, at, SYSTEM, 'queued', `Заявка передана специалисту: ${route.allCodes.join(', ')}`, { clientText: 'Заявку проверит специалист' });
    }
  }
}

/** Прогнать все шаги сразу — для сида. */
export function runPipelineSync(app: Application, at: Date): Application {
  let cur = app;
  let t = at.getTime();
  for (let i = 0; i < 12 && (cur.status === 'SUBMITTED' || cur.status === 'AUTO_CHECKS'); i++) {
    t += 450;
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
  revenueByMonth: [],
  cashflowByMonth: [],
  expenses: { suppliers: 0, payroll: 0, taxes: 0, rent: 0, other: 0 },
  variableShare: 0,
  fixedMonthly: 0,
  topBuyerShare: 0,
  cashShare: 0,
});

export function statementFinancials(inn: string) {
  const s = analyzeStatement(inn);
  return {
    revenue12m: s.revenue12m,
    avgTurnover12m: s.avgTurnover12m,
    avgTurnover3m: s.avgTurnover3m,
    turnoverByMonth: s.turnoverByMonth,
    revenueByMonth: s.revenueByMonth,
    cashflowByMonth: s.cashflowByMonth,
    expenses: s.expenses,
    variableShare: s.variableShare,
    fixedMonthly: s.fixedMonthly,
    topBuyerShare: s.topBuyerShare,
    cashShare: s.cashShare,
  };
}

/** Финансы для мастера: выписка + БКИ (клиент может поправить выручку и долги) */
export function prefillFinancials(inn: string): Financials {
  const r = bkiReport(inn);
  return {
    ...emptyFinancials(),
    ...statementFinancials(inn),
    existingDebt: r.totalDebt,
    bkiDebt: r.totalDebt,
    existingMonthlyPayments: r.monthlyPayments,
    existingLoans: r.loans,
    overdueCurrent: r.currentOverdueDays > 0,
    overdueClosed12m: r.worstClosed24m === 'none' ? 0 : 1,
  };
}

/** Выписка, загруженная сейчас, — по последний полный месяц */
export const freshStatementPeriod = (at: Date) => lastFullMonth(at);

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

/** Напоминание клиенту о запрошенных документах (без смены статуса). */
export function remind(app: Application, employee: Actor, at: Date): Application {
  if (app.status !== 'NEED_INFO') throw new Error('Напоминание доступно, только когда ждём документы');
  const open = openRequests(app);
  const due = open.map((r) => r.dueAt).sort()[0];
  const text = `Напоминаем: ждём ${open.map((r) => DOC_TYPES[r.docType].title.toLowerCase()).join(', ')}${due ? ` до ${fullDate(due)}` : ''}. Загрузить можно в карточке заявки.`;
  const withMsg = sendMessage(app, employee, text, at);
  return withEvent(withMsg, at, employee, 'reminded', 'Клиенту отправлено напоминание о документах', { clientText: 'Специалист напомнил о документах' });
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

export interface TermsPreview {
  metrics: Metrics;
  /** почему положительное решение на этих условиях запрещено */
  blockers: string[];
  /** максимум суммы для сотрудника: расчётный лимит + 10% */
  maxAllowed: number;
}

/** Расчёт для формы решения: метрики на выбранных условиях и запреты политики (§13). */
export function previewTerms(app: Application, terms: Terms, at = new Date()): TermsPreview {
  const product = productOf(app);
  const metrics = computeMetrics(app.financials!, terms, product, at);
  const maxAllowed = Math.floor((metrics.manualLimit * (1 + POLICY.MANUAL_OVER_LIMIT)) / 50_000) * 50_000;
  const blockers: string[] = [];
  const hard = (app.route?.allCodes ?? []).filter((c) => codeInfo(c).level === 'H' || c === 'S01X');
  if (hard.length) blockers.push(`Жёсткий стоп ${hard.join(', ')} — снимается только изменением факта в источнике`);
  const grade = app.scoring?.grade;
  if (grade === 'D' || grade === 'E') blockers.push(`Группа риска ${grade} — положительное решение запрещено (F01)`);
  if (metrics.cfNegative) blockers.push('Денежный поток отрицательный — кредит не обслуживается');
  if (metrics.dscr !== null && metrics.dscr < POLICY.DSCR_REJECT) blockers.push(`DSCR ${f2(metrics.dscr)} < 1,0 на выбранных условиях`);
  if (metrics.dscrStress !== null && metrics.dscrStress < POLICY.DSCR_STRESS_GRAY) blockers.push(`Стресс-DSCR ${f2(metrics.dscrStress)} < 0,9 на выбранных условиях`);
  if (terms.amount > maxAllowed) blockers.push(`Сумма выше расчётного лимита ${rub(metrics.manualLimit)} + 10% (${rub(maxAllowed)})`);
  const soft = (app.route?.allCodes ?? []).filter((c) => codeInfo(c).level === 'S');
  if (soft.length) blockers.push(`Снимите мягкие стопы: ${soft.join(', ')}`);
  return { metrics, blockers, maxAllowed };
}

/** Решение вопреки рекомендации модели требует второго подтверждения. */
export function secondApprovalReason(app: Application, d: Pick<DecisionDraft, 'type'>): string | null {
  const rec = app.recommendation;
  const grade = app.scoring?.grade;
  if (d.type === 'approve' && grade === 'C') return 'одобрение заявки группы C';
  if (d.type === 'approve' && rec && rec.type !== 'approve') return `одобрение, хотя система рекомендует ${rec.type === 'reject' ? 'отказ' : 'контрпредложение'}`;
  if (d.type === 'counter_offer' && rec?.type === 'reject') return 'контрпредложение, хотя система рекомендует отказ';
  return null;
}

function validateDecision(app: Application, d: DecisionDraft, at: Date) {
  const invalid = validateTerms(productOf(app), d.terms);
  if (invalid) throw new Error(invalid);
  const bounds = rateBounds(productOf(app));
  if (d.terms.rate < bounds.min || d.terms.rate > bounds.max) throw new Error(`Ставка — от ${bounds.min} до ${bounds.max}%`);
  const allowed = DECISION_REASONS[d.type === 'approve' ? 'approve' : 'counter_offer'].map((r) => r.code);
  if (!allowed.includes(d.reasonCode as never)) throw new Error('Выберите код причины решения');
  if (d.justification.trim().length < 20) throw new Error('Обоснование — не меньше 20 символов');
  const { blockers } = previewTerms(app, d.terms, at);
  if (blockers.length) throw new Error(blockers.join('. '));
}

function applyDecision(app: Application, initiator: Actor, d: DecisionDraft, at: Date, confirmedBy?: Actor): Application {
  const to = d.type === 'approve' ? 'APPROVED' : 'COUNTER_OFFER';
  const next = moveTo(app, to, at);
  const t = d.terms;
  const summary = `${rub(t.amount)}, ${months(t.term)}, ${t.rate}%`;
  return withEvent(
    {
      ...next,
      pendingDecision: undefined,
      decision: {
        type: d.type,
        variant: d.variant,
        terms: t,
        reasonCode: d.reasonCode,
        routeCodes: app.route?.allCodes ?? [],
        justification: d.justification.trim(),
        clientMessage:
          d.clientMessage.trim() ||
          (d.type === 'approve' ? 'Заявка одобрена. Проверьте условия и подтвердите их.' : 'Мы можем выдать кредит на других условиях — посмотрите предложение.'),
        decidedBy: initiator.name,
        decidedById: initiator.id,
        confirmedBy: confirmedBy?.name,
        decidedAt: iso(at),
        validUntil: iso(addDays(at, d.validDays)),
      },
    },
    at,
    confirmedBy ?? initiator,
    'decision',
    `Решение${confirmedBy ? ` (подтвердил ${confirmedBy.name})` : ''}: ${d.type === 'approve' ? (d.variant === 'other_terms' ? 'одобрено на других условиях' : 'одобрено') : 'встречное предложение'} (${summary}), ${d.reasonCode}`,
    { clientText: d.type === 'approve' ? 'Заявка одобрена' : 'Банк предложил другие условия' },
  );
}

/** Решение сотрудника. Вопреки рекомендации — ждёт второго подтверждения (статус не меняется). */
export function makeDecision(app: Application, employee: Actor, d: DecisionDraft, at: Date): Application {
  if (app.pendingDecision) throw new Error('По заявке уже есть решение, которое ждёт подтверждения');
  validateDecision(app, d, at);
  const reason = secondApprovalReason(app, d);
  if (reason) {
    return withEvent(
      { ...app, pendingDecision: { decision: d, initiatorId: employee.id!, initiatorName: employee.name, at: iso(at), reason } },
      at,
      employee,
      'decision_pending',
      `Решение ждёт второго подтверждения (${reason}): ${d.type === 'approve' ? 'одобрение' : 'контрпредложение'} ${rub(d.terms.amount)}, ${d.reasonCode}`,
      { visibleToClient: false },
    );
  }
  return applyDecision(app, employee, d, at);
}

export function confirmDecision(app: Application, second: Actor, at: Date): Application {
  const p = app.pendingDecision;
  if (!p) throw new Error('Нет решения, ожидающего подтверждения');
  if (p.initiatorId === second.id) throw new Error('Второе подтверждение даёт другой сотрудник');
  validateDecision(app, p.decision, at);
  return applyDecision(app, { role: 'employee', id: p.initiatorId, name: p.initiatorName }, p.decision, at, second);
}

export function returnDecision(app: Application, second: Actor, comment: string, at: Date): Application {
  const p = app.pendingDecision;
  if (!p) throw new Error('Нет решения, ожидающего подтверждения');
  if (p.initiatorId === second.id) throw new Error('Вернуть решение может только другой сотрудник');
  if (comment.trim().length < 20) throw new Error('Комментарий — не меньше 20 символов');
  return withEvent({ ...app, pendingDecision: undefined }, at, second, 'decision_returned', `Решение возвращено на доработку: ${comment.trim()}`, { visibleToClient: false });
}

/** Снятие мягкого стоп-фактора: код причины + документ или проверка + обоснование (§13, шаг 4). */
export function waiveSoftStop(app: Application, employee: Actor, input: { code: string; reasonCode: string; evidence: string; comment: string }, at: Date): Application {
  if (codeInfo(input.code).level !== 'S') throw new Error('Снять можно только мягкий стоп-фактор (S01–S10)');
  if (!(app.route?.allCodes ?? []).includes(input.code)) throw new Error('Этот стоп-фактор сейчас не сработал');
  if (!WAIVER_REASONS.some((r) => r.code === input.reasonCode)) throw new Error('Выберите код причины');
  if (!input.evidence.trim()) throw new Error('Укажите документ или проверку');
  if (input.comment.trim().length < 20) throw new Error('Обоснование — не меньше 20 символов');
  const waiver = { ...input, comment: input.comment.trim(), by: employee.name, at: iso(at) };
  const next = withEvent({ ...app, waivers: [...(app.waivers ?? []), waiver] }, at, employee, 'waived', `Снят мягкий стоп ${input.code} (${input.reasonCode}): ${input.evidence}`, {
    visibleToClient: false,
  });
  return reassess(next, at, employee, `снят ${input.code}`);
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
      pendingDecision: undefined,
      decision: {
        type: 'reject',
        reasonCode: reason.code,
        routeCodes: app.route?.allCodes ?? [],
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

/* ---------- Действия клиента ---------- */

/** Загрузка документов. requestId — закрыть конкретный запрос (только документом его типа). */
export function addDocuments(app: Application, client: Actor, files: Omit<DocFile, 'source' | 'addedBy'>[], at: Date, requestId?: string): Application {
  if (!files.length) return app;
  if (!isEditable(app.status)) throw new Error('Сейчас документы к заявке добавить нельзя');
  let requests = app.docRequests;
  const added: DocFile[] = [];
  for (const f of files) {
    const target = requestId ? requests.find((r) => r.id === requestId) : requests.find((r) => !r.fulfilledByDocId && r.docType === f.docType);
    if (requestId) {
      if (!target || target.fulfilledByDocId) throw new Error('Запрос уже закрыт');
      if (target.docType !== f.docType) throw new Error(`Этот запрос закрывается только документом «${DOC_TYPES[target.docType].title}»`);
    }
    // новая выписка — по последний полный месяц (содержимое файла в прототипе не читается)
    const doc: DocFile = { ...f, periodTo: f.docType === 'bank_statement' ? f.periodTo ?? lastFullMonth(at) : f.periodTo, addedBy: 'client', source: target ? 'request' : 'later' };
    added.push(doc);
    if (target) requests = requests.map((r) => (r.id === target.id ? { ...r, fulfilledByDocId: doc.id, fulfilledAt: iso(at) } : r));
  }
  let next: Application = { ...app, documents: [...app.documents, ...added], docRequests: requests };
  next = { ...next, checks: setCheck(next.checks, documentsCheck(next)) };
  const names = added.map((d) => DOC_TYPES[d.docType].title.toLowerCase()).join(', ');
  next = withEvent(next, at, client, 'client_docs', `Клиент загрузил: ${names}`, { clientText: `Вы загрузили: ${names}` });

  if (next.status === 'NEED_INFO' && openRequests(next).length === 0) {
    // Запрос специалиста — заявка возвращается ему; системный — проверки повторяются с шага 1 (§7)
    if (next.assigneeId) {
      next = moveTo(next, 'IN_REVIEW', at);
      next = withEvent({ ...next, newDocsForEmployee: true }, at, client, 'client_answered', 'Клиент ответил на все запросы — заявка снова у специалиста', {
        clientText: 'Все запрошенные документы получены — заявка снова у специалиста',
      });
      return reassess(next, at, SYSTEM, 'новые документы');
    }
    return restartChecks(next, at, client, 'все запрошенные сведения получены');
  }
  if (next.status === 'IN_REVIEW' || next.status === 'NEED_INFO') return { ...next, newDocsForEmployee: true };
  if (next.status === 'IN_QUEUE') return restartChecks(next, at, client, 'добавлены документы');
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
  return ['amount', 'revenue12m', 'existingDebt', 'existingMonthlyPayments'].includes(field) ? rub(Number(v)) : String(v);
}

/** Клиент меняет данные после отправки (правила изменения — README). */
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
    // решение, ждавшее подтверждения, считалось на старых данных
    pendingDecision: undefined,
    changes: [...app.changes, ...diffs.map((d) => ({ version, at: iso(at), ...d }))],
  };
  next = withEvent(next, at, client, 'client_changed', `Клиент изменил ${text}`, { clientText: `Вы изменили ${text}` });

  if (next.status === 'IN_QUEUE') return restartChecks(next, at, client, 'клиент изменил данные');

  next = reassess({ ...next, changedSinceReview: true }, at, SYSTEM, 'клиент изменил данные');
  return sendMessage(next, client, `Изменены данные заявки: ${text}. Оценка пересчитана.`, at);
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
  return withEvent({ ...next, pendingDecision: undefined }, at, client, 'withdrawn', 'Заявка отозвана клиентом', { clientText: 'Вы отозвали заявку' });
}

export const describeTerms = (t: Terms) =>
  `${rub(t.amount)} на ${months(t.term)}, ${t.rate}% · ${PAYMENT_TYPE_LABEL[t.paymentType]}${t.graceMonths ? ` (${t.graceMonths} мес.)` : ''}`;
