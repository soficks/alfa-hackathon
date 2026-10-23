import type { Application, AppStatus, DocType, Metrics, Recommendation, Route, Scoring, Terms, TraceStep } from '../domain/types.ts';
import { isValidInn } from '../domain/requisites.ts';
import { monthsBetween } from '../domain/time.ts';
import { AMOUNT_STEP, type Product } from '../config/products.ts';
import { POLICY } from '../config/policy.ts';
import { DOC_TYPES } from '../config/docTypes.ts';
import { NEUTRAL_REJECT_TEXT, codeInfo } from '../config/routeCodes.ts';
import { months, percent, rub } from '../utils/format.ts';
import { computeMetrics, findAlternatives, minimalVariant, passesAuto } from './affordability.ts';
import { taxDebtAboveS06 } from './scoring.ts';

/**
 * Маршрут заявки (docs/TZ_credit_pipeline.md, §3): шаги 0–8 в неизменяемом порядке
 * H → D → F → S → G → C → одобрение. Сработавшие коды всех пройденных шагов сохраняются.
 * Скоринг отвечает на вопрос «насколько рискованно», а маршрут — «что делать с заявкой».
 */

export interface DocRequestDraft {
  docType: DocType;
  reasonCode: string;
  comment: string;
}

export interface RouteResult {
  route: Route;
  trace: TraceStep[];
  recommendation: Recommendation;
  /** что запросить у клиента при NEED_INFO */
  requests: DocRequestDraft[];
  /** условия авто-одобрения или авто-контрпредложения */
  terms?: Terms;
  /** текст отказа для клиента — без защищённых кодов */
  clientRejectText?: string;
}

export interface RouteInput {
  app: Application;
  product: Product;
  scoring: Scoring;
  metrics: Metrics;
  now?: Date;
}

const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2).replace('.', ','));

const STEP_TITLES = [
  'Валидация и согласия (V01–V08)',
  'Жёсткие стоп-факторы (H01–H09, S01X)',
  'Полнота и свежесть сведений (D01–D14)',
  'Финансовый отказ (F01–F03)',
  'Мягкие стоп-факторы (S01–S10)',
  'Лимит, залог, полномочия (G01–G03, G09)',
  'Группа C и пограничные показатели (G04–G08, G10, G11)',
  'Контрпредложение (C01–C03)',
  'Авто-одобрение',
];

const OUTCOME_LABEL: Partial<Record<AppStatus, string>> = {
  DRAFT: 'Не прошла валидацию',
  APPROVED: 'Автоодобрение',
  REJECTED: 'Автоотказ',
  NEED_INFO: 'Запрос сведений',
  COUNTER_OFFER: 'Контрпредложение',
  IN_QUEUE: 'Серая зона',
};

/** Последний полный месяц в формате ГГГГ-ММ */
export function lastFullMonth(now: Date) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Шаг 0: валидация заявки перед отправкой. Пустой список — можно отправлять. */
export function validate(app: Application, product: Product): Record<string, string> {
  const t = app.requested;
  const codes: Record<string, string> = {};
  if (!isValidInn(app.company.inn)) codes.V01 = `ИНН ${app.company.inn} не проходит контрольную сумму`;
  if (!app.company.ogrn) codes.V02 = 'компания не найдена в реестре';
  if (t.amount < product.minAmount || t.amount > product.maxAmount || t.amount % AMOUNT_STEP) {
    codes.V03 = `сумма ${rub(t.amount)} вне ${rub(product.minAmount)}–${rub(product.maxAmount)} или не кратна 50 000 ₽`;
  }
  if (t.term < product.minTerm || t.term > product.maxTerm || !product.paymentTypes.includes(t.paymentType)) codes.V04 = 'срок или тип графика недоступен';
  if (!app.consents.bki) codes.V05 = 'нет согласия на запрос в БКИ';
  if (!app.consents.personalData) codes.V06 = 'нет согласия на обработку персональных данных';
  if (!app.consents.authority) codes.V07 = 'не подтверждены полномочия';
  if (!app.documents.some((d) => d.docType === 'bank_statement')) codes.V08 = 'нет выписки по счёту';
  return codes;
}

export function computeRoute({ app, product, scoring, metrics, now = new Date() }: RouteInput): RouteResult {
  const f = app.financials!;
  const s = app.sources!;
  const h = app.creditHistory!;
  const t = app.requested;
  const ageMonths = monthsBetween(new Date(app.company.registeredAt), now);
  const hasCollateral = product.collateral.required;
  const waived = new Set((app.waivers ?? []).map((w) => w.code));

  const codes: Record<number, Record<string, string>> = {};
  const fire = (step: number, code: string, detail: string) => ((codes[step] ??= {})[code] = detail);

  /* Шаг 0 — валидация */
  Object.entries(validate(app, product)).forEach(([c, d]) => fire(0, c, d));

  /* Шаг 1 — жёсткие стопы: собираем все */
  if (s.registryStatus !== 'active') fire(1, 'H01', `статус в ЕГРЮЛ: ${s.registryStatus === 'liquidated' ? 'ликвидирована' : s.registryStatus}`);
  if (s.bankruptcy) fire(1, 'H02', 'есть сообщение о банкротстве в Федресурсе');
  if (s.sanctions) fire(1, 'H03', 'совпадение с перечнями');
  if (s.zskRisk === 'high') fire(1, 'H04', 'высокий уровень риска ЗСК ЦБ');
  if (s.unreliableData) fire(1, 'H05', 'отметка о недостоверности в ЕГРЮЛ');
  if (s.directorDisqualified) fire(1, 'H06', 'руководитель в реестре дисквалифицированных лиц');
  if (s.fraudConfirmed) fire(1, 'H07', 'подтверждённая подделка документов');
  if (s.fnsBlocked) fire(1, 'H08', 'ФНС приостановила операции по счетам');
  const overdue = Math.max(h.company.currentOverdueDays, h.director.currentOverdueDays);
  if (overdue > POLICY.H09_OVERDUE_DAYS) fire(1, 'H09', `текущая просрочка ${overdue} дн.`);
  if (ageMonths < POLICY.AGE_MIN && !hasCollateral) fire(1, 'S01X', `бизнесу ${ageMonths} мес., залога нет`);

  /* Шаг 2 — недостающие, несвежие и противоречивые сведения */
  const requests: DocRequestDraft[] = [];
  const need = (code: string, docType: DocType, detail: string, comment: string) => {
    fire(2, code, detail);
    requests.push({ docType, reasonCode: code, comment });
  };
  const has = (type: DocType) => app.documents.some((d) => d.docType === type);
  const statement = app.documents.filter((d) => d.docType === 'bank_statement').sort((a, b) => (b.periodTo ?? '').localeCompare(a.periodTo ?? ''))[0];
  if (!statement) need('D01', 'bank_statement', 'нет выписки за 12 месяцев', 'Выписка по расчётному счёту за последние 12 месяцев в Excel или 1С.');
  else if (statement.periodTo && statement.periodTo < lastFullMonth(now)) {
    need('D08', 'bank_statement', `выписка по ${statement.periodTo}, нужна по ${lastFullMonth(now)}`, `Выписка по последний полный месяц (${lastFullMonth(now)}) — в загруженной его нет.`);
  }
  if (app.company.form === 'ООО' && product.requiredDocs.includes('financial_statements') && !has('financial_statements')) {
    need('D04', 'financial_statements', 'нет актуальной отчётности ООО', 'Бухгалтерский баланс и отчёт о финансовых результатах за последний год.');
  }
  for (const doc of product.requiredDocs) {
    if (has(doc) || ['bank_statement', 'financial_statements', 'debt_certificate', 'collateral'].includes(doc)) continue;
    need('D06', doc, `нет документа: ${DOC_TYPES[doc].title.toLowerCase()}`, `${DOC_TYPES[doc].title}: ${DOC_TYPES[doc].why.toLowerCase()}`);
  }
  if (product.requiredDocs.includes('debt_certificate') && !has('debt_certificate')) {
    need('D07', 'debt_certificate', 'нет расшифровки долгов', 'Справка о задолженности: кредиторы, остатки, ставки и графики.');
  }
  if (product.requiredDocs.includes('collateral') && !has('collateral')) {
    need('D12', 'collateral', 'нет документов на залог', 'Документы на залог: выписка ЕГРН и отчёт об оценке.');
  }
  // D09: долг в анкете и в БКИ расходятся больше чем на 10%
  if (f.bkiDebt !== undefined && Math.abs(f.existingDebt - f.bkiDebt) / Math.max(f.bkiDebt, 1) > POLICY.D09_DEBT_DIFF && !has('debt_certificate')) {
    need('D09', 'debt_certificate', `в анкете ${rub(f.existingDebt)}, по БКИ ${rub(f.bkiDebt)}`, 'Расшифровка действующих кредитов: в анкете и кредитной истории суммы расходятся.');
  }
  if (s.girboRevenue && Math.abs(s.girboRevenue - f.revenue12m) / f.revenue12m > POLICY.D10_GIRBO_DIFF && !has('financial_statements')) {
    need('D10', 'financial_statements', `ГИР БО ${rub(s.girboRevenue)}, выписка ${rub(f.revenue12m)}`, 'Отчётность для сверки: выручка по ГИР БО и по выписке расходятся больше чем на 10%.');
  }
  const cyclesLeft = (app.needInfoCycle ?? 0) < POLICY.NEED_INFO_CYCLES;

  /* Шаг 3 — финансовый отказ */
  const minimal = computeMetrics(f, minimalVariant(product, t), product, now);
  if (scoring.grade === 'D' || scoring.grade === 'E') fire(3, 'F01', `балл ${scoring.score}, группа ${scoring.grade} (< 580)`);
  if (minimal.cfNegative || (minimal.dscr !== null && minimal.dscr < POLICY.DSCR_REJECT)) {
    fire(3, 'F02', minimal.cfNegative ? 'денежный поток отрицательный' : `DSCR ${f2(minimal.dscr)} < 1,0 даже на ${rub(product.minAmount)} / ${months(product.maxTerm)}`);
  }
  if (minimal.cfNegative || (minimal.debtCf ?? Infinity) > POLICY.DEBT_CF_MAX) {
    fire(3, 'F03', minimal.cfNegative ? 'CF ≤ 0 — долг/CF не считается' : `долг / CF ${f2(minimal.debtCf)} > 4 на минимальном варианте`);
  }

  /* Шаг 4 — мягкие стопы (снятые сотрудником не считаются) */
  const soft = (code: string, detail: string) => {
    if (waived.has(code)) return;
    fire(4, code, detail);
  };
  if (ageMonths >= POLICY.AGE_MIN && ageMonths < POLICY.AGE_OK) soft('S01', `бизнесу ${ageMonths} мес.`);
  else if (ageMonths < POLICY.AGE_MIN && hasCollateral) soft('S01', `бизнесу ${ageMonths} мес., есть залог`);
  if (h.company.worstClosed24m === 'over_90' || h.director.worstClosed24m === 'over_90') soft('S02', 'закрытая просрочка > 90 дней за 24 мес.');
  const declDiff = Math.abs(s.declaredRevenue - f.revenue12m) / Math.max(f.revenue12m, 1);
  if (declDiff > POLICY.S03_DECLARATION_DIFF) soft('S03', `декларация и выписка расходятся на ${percent(declDiff)}`);
  if (f.topBuyerShare > POLICY.S04_TOP_BUYER) soft('S04', `крупнейший покупатель — ${percent(f.topBuyerShare)} поступлений`);
  if (s.negativeNetAssets2y) soft('S05', 'отрицательные чистые активы / убыток два года');
  if (taxDebtAboveS06(s, metrics.cf)) soft('S06', `налоги и ФССП ${rub(s.taxDebt + s.fsspDebt)} > 10% месячного CF`);
  if (s.zskRisk === 'medium') soft('S07', 'средний уровень риска ЗСК ЦБ');
  if (s.lawsuits > POLICY.S08_LAWSUITS_TO_REVENUE * f.revenue12m) soft('S08', `иски на ${rub(s.lawsuits)}`);
  if (metrics.trend !== null && metrics.trend < POLICY.TREND_MIN) soft('S09', `тренд выручки ${f2(metrics.trend)} < 0,7`);
  if (f.cashShare > POLICY.S10_CASH_SHARE) soft('S10', `наличные и переводы физлицам — ${percent(f.cashShare)} поступлений`);

  /* Шаг 5 — лимит, залог, полномочия */
  if (t.amount > POLICY.AUTO_AUTHORITY) fire(5, 'G01', `сумма ${rub(t.amount)} выше авто-лимита ${rub(POLICY.AUTO_AUTHORITY)}`);
  if (hasCollateral) fire(5, 'G02', 'залог — коммерческая недвижимость, нужна экспертиза');
  if (app.company.form === 'ООО' && t.amount > POLICY.CORPORATE_APPROVAL_AMOUNT) fire(5, 'G03', `сделка больше ${rub(POLICY.CORPORATE_APPROVAL_AMOUNT)} — нужно одобрение участников`);
  if (t.amount > POLICY.EMPLOYEE_AUTHORITY) fire(5, 'G09', `сумма выше полномочий сотрудника ${rub(POLICY.EMPLOYEE_AUTHORITY)}`);

  /* Шаг 6 — пограничные показатели (первыми — финансовые, они конкретнее) и группа C */
  if (metrics.dscr !== null && metrics.dscr >= POLICY.DSCR_GRAY && metrics.dscr < POLICY.DSCR_MIN) fire(6, 'G05', `DSCR ${f2(metrics.dscr)} в пограничной зоне 1,1–1,25`);
  if (metrics.dscrStress !== null && metrics.dscrStress >= POLICY.DSCR_STRESS_GRAY && metrics.dscrStress < POLICY.DSCR_STRESS_MIN) {
    fire(6, 'G06', `стресс-DSCR ${f2(metrics.dscrStress)} в пограничной зоне 0,9–1,0`);
  }
  if (metrics.debtCf !== null && metrics.debtCf > POLICY.DEBT_CF_OK && metrics.debtCf <= POLICY.DEBT_CF_MAX) fire(6, 'G07', `долг / CF ${f2(metrics.debtCf)} в зоне 3–4`);
  if (scoring.grade === 'C') fire(6, 'G04', `балл ${scoring.score}, группа C (580–609)`);
  if (app.company.form === 'ИП' && !app.consents.automated) fire(6, 'G08', 'ИП не дал согласие на автоматизированное решение');
  if (codes[2] && !cyclesLeft) fire(6, 'G10', `сведения уже запрашивались ${app.needInfoCycle} раза`);
  if (metrics.dscrWeak !== undefined && metrics.dscrWeak !== null && metrics.dscrWeak < POLICY.DSCR_REJECT) {
    fire(6, 'G11', `CV ${f2(metrics.cv)} > 0,3, DSCR слабого периода ${f2(metrics.dscrWeak)}`);
  }

  /* Шаг 7 — запрос непосилен: контрпредложение или F04 */
  if (metrics.dscr !== null && metrics.dscr < POLICY.DSCR_GRAY) fire(7, 'C01', `DSCR ${f2(metrics.dscr)} < 1,1 на запрошенных условиях`);
  if (metrics.dscrStress !== null && metrics.dscrStress < POLICY.DSCR_STRESS_GRAY) fire(7, 'C02', `стресс-DSCR ${f2(metrics.dscrStress)} < 0,9`);
  if (t.amount > metrics.autoLimit || (metrics.debtCf ?? Infinity) > POLICY.DEBT_CF_OK) {
    fire(7, 'C03', `сумма ${rub(t.amount)} выше расчётного лимита ${rub(metrics.autoLimit)} на ${months(t.term)}`);
  }

  /* ---------- Какой шаг решающий ---------- */
  const fired = (step: number) => !!codes[step] && Object.keys(codes[step]).length > 0;
  let decisive = 8;
  let status: AppStatus = 'APPROVED';
  let terms: Terms | undefined;
  const autoAlternatives = fired(7) ? findAlternatives(f, t, product, 'auto', now) : [];

  if (fired(0)) [decisive, status] = [0, 'DRAFT'];
  else if (fired(1)) [decisive, status] = [1, 'REJECTED'];
  else if (fired(2) && cyclesLeft) [decisive, status] = [2, 'NEED_INFO'];
  else if (fired(3)) [decisive, status] = [3, 'REJECTED'];
  else if (fired(4)) [decisive, status] = [4, 'IN_QUEUE'];
  else if (fired(5)) [decisive, status] = [5, 'IN_QUEUE'];
  else if (fired(6)) [decisive, status] = [6, 'IN_QUEUE'];
  else if (fired(7)) {
    decisive = 7;
    if (autoAlternatives.length) {
      status = 'COUNTER_OFFER';
      terms = autoAlternatives[0].terms;
    } else {
      status = 'REJECTED';
      fire(7, 'F04', 'не нашлось суммы и срока, при которых выполняются все условия');
    }
  } else {
    terms = { ...t, rate: scoring.grade === 'A' ? product.baseRate - 1 : product.baseRate };
  }

  // Серая зона: шаги 4–6 ведут в одну очередь, поэтому показываем коды всех трёх
  const lastEvaluated = status === 'IN_QUEUE' ? 6 : decisive;
  const trace: TraceStep[] = STEP_TITLES.map((title, step) => {
    const stepCodes = Object.keys(codes[step] ?? {});
    if (step > lastEvaluated) return { step, title, result: 'skipped', codes: [] };
    const result: TraceStep['result'] = stepCodes.length ? 'fired' : 'pass';
    const details = stepCodes.map((c) => `${c}: ${codes[step][c]}`).join('; ') || undefined;
    if (step === 2 && stepCodes.length && !cyclesLeft) return { step, title, result, codes: stepCodes, details: `${details}. Циклы запросов исчерпаны — G10` };
    return { step, title, result, codes: stepCodes, details };
  });
  if (status === 'APPROVED') trace[8] = { ...trace[8], result: 'fired', codes: [], details: `Группа ${scoring.grade}, DSCR ${f2(metrics.dscr)}, стресс ${f2(metrics.dscrStress)}, долг/CF ${f2(metrics.debtCf)}` };

  const allCodes = trace.flatMap((x) => x.codes);
  const details: Record<string, string> = {};
  for (let step = 0; step <= lastEvaluated; step++) Object.assign(details, codes[step] ?? {});
  const decisiveCodes = Object.keys(codes[decisive] ?? {});
  const primaryCode = decisive === 8 ? 'OK' : decisive === 7 && status === 'REJECTED' ? 'F04' : decisiveCodes[0] ?? '';
  const summary =
    status === 'APPROVED'
      ? `${OUTCOME_LABEL.APPROVED} · шаг 8 · все условия выполнены — группа ${scoring.grade}, DSCR ${f2(metrics.dscr)}`
      : `${OUTCOME_LABEL[status]} · шаг ${decisive} · ${primaryCode} — ${details[primaryCode] ?? codeInfo(primaryCode).title}`;

  const isProtected = allCodes.some((c) => codeInfo(c).protected);
  const clientRejectCode = allCodes.find((c) => ['H', 'F'].includes(codeInfo(c).level) || c === 'S01X');
  const clientRejectText = isProtected ? NEUTRAL_REJECT_TEXT : clientRejectCode ? codeInfo(clientRejectCode).client : undefined;

  return {
    route: { status, step: decisive, primaryCode, allCodes, details, summary },
    trace,
    recommendation: recommend({ app, product, scoring, metrics, now }, allCodes),
    requests: status === 'NEED_INFO' ? requests : [],
    terms,
    clientRejectText,
  };
}

/**
 * Рекомендация для сотрудника: что делать с заявкой из серой зоны.
 * Альтернативы ищутся с лимитом полномочий сотрудника, а не авто-лимитом.
 */
export function recommend({ app, product, scoring, metrics, now = new Date() }: RouteInput, codes: string[]): Recommendation {
  const hard = codes.filter((c) => codeInfo(c).level === 'H' || c === 'S01X');
  if (hard.length) return { type: 'reject', text: `Рекомендуем отказ: жёсткий стоп ${hard.join(', ')}`, alternatives: [] };
  if (scoring.grade === 'D' || scoring.grade === 'E') return { type: 'reject', text: `Рекомендуем отказ: группа ${scoring.grade}`, alternatives: [] };
  const financialOk = passesAuto(metrics) && app.requested.amount <= metrics.manualLimit;
  if (financialOk) return { type: 'approve', text: 'Рекомендуем одобрить на запрошенных условиях', alternatives: [] };
  const alternatives = findAlternatives(app.financials!, app.requested, product, 'manual', now);
  if (alternatives.length) {
    const best = alternatives[0].terms;
    return { type: 'counter_offer', text: `Рекомендуем контрпредложение: ${rub(best.amount)} на ${months(best.term)}`, alternatives };
  }
  return { type: 'reject', text: 'Рекомендуем отказ: нет условий, которые компания может обслуживать', alternatives: [] };
}
