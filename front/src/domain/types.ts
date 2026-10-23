export type LegalForm = 'ООО' | 'ИП';
export type Role = 'client' | 'employee';

export type AppStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AUTO_CHECKS'
  | 'IN_QUEUE'
  | 'IN_REVIEW'
  | 'NEED_INFO'
  | 'APPROVED'
  | 'COUNTER_OFFER'
  | 'SIGNING'
  | 'ISSUED'
  | 'REJECTED'
  | 'DECLINED_BY_CLIENT'
  | 'WITHDRAWN';

export type PaymentType = 'annuity' | 'differentiated' | 'interest_only' | 'annuity_grace';

export type DocType =
  | 'bank_statement'
  | 'financial_statements'
  | 'supplier_invoice'
  | 'purchase_contract'
  | 'estimate'
  | 'business_plan'
  | 'gov_contract'
  | 'debt_certificate'
  | 'collateral'
  | 'other';

export interface Company {
  inn: string;
  ogrn: string;
  form: LegalForm;
  name: string;
  address: string;
  /** ISO-дата регистрации */
  registeredAt: string;
  okved: string;
  okvedName: string;
  status: 'active' | 'liquidated';
  head: string;
}

export interface Terms {
  amount: number;
  /** срок в месяцах */
  term: number;
  /** % годовых */
  rate: number;
  paymentType: PaymentType;
  /** месяцев отсрочки для annuity_grace */
  graceMonths?: number;
}

export interface DocFile {
  id: string;
  name: string;
  size: number;
  docType: DocType;
  addedAt: string;
  addedBy: Role;
  /** при подаче или по запросу банка */
  source: 'submission' | 'request' | 'later';
  demo?: boolean;
  /** выписка: последний месяц периода, ГГГГ-ММ (D08 — свежесть) */
  periodTo?: string;
}

export interface DocRequest {
  id: string;
  docType: DocType;
  comment: string;
  dueAt: string;
  createdAt: string;
  createdBy: string;
  /** код запроса сведений D01–D14 — если запрос создала система */
  reasonCode?: string;
  /** цикл запроса сведений (максимум 2) */
  cycle?: number;
  fulfilledByDocId?: string;
  fulfilledAt?: string;
  /** клиент видел запрос (для колокольчика) */
  seenByClient: boolean;
}

export interface Message {
  id: string;
  author: Role;
  authorName: string;
  text: string;
  createdAt: string;
  readByClient: boolean;
  readByEmployee: boolean;
}

export interface HistoryEvent {
  id: string;
  at: string;
  actor: Role | 'system';
  actorName?: string;
  type: string;
  text: string;
  /** формулировка для клиента, если отличается от внутренней */
  clientText?: string;
  visibleToClient: boolean;
}

export interface CheckResult {
  id: 'registry' | 'sources' | 'bki' | 'requisites' | 'documents';
  status: 'ok' | 'warn' | 'fail';
  title: string;
  details: string[];
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

/** Строка экспертной скоринговой карты (§9 ТЗ). */
export interface ScoringFactor {
  code: 'age' | 'history' | 'trend' | 'tax' | 'industry';
  title: string;
  /** значение клиента: «4 года 2 месяца», «тренд 1,08» */
  value: string;
  /** категория карты, в которую попал клиент */
  category: string;
  points: number;
  maxPoints: number;
}

/** Результат скоринга: S = сумма пяти вкладов (300–660), odds и PD по калибровке §10. */
export interface Scoring {
  score: number;
  odds: number;
  pd: number;
  grade: Grade;
  factors: ScoringFactor[];
  calculatedAt: string;
  policyVersion: string;
}

/** Показатели платёжеспособности (§8 ТЗ). Суммы — ₽ в месяц, если не сказано иное. */
export interface Metrics {
  /** очищенная выручка, среднемесячная */
  rev: number;
  /** операционный денежный поток, среднемесячный */
  cf: number;
  /** текущие платежи по кредитам и лизингу */
  dsCurrent: number;
  /** платёж по новому кредиту (для дифференцированного — первый) */
  aNew: number;
  /** null — знаменатель равен нулю */
  dscr: number | null;
  /** доля переменных расходов v и постоянные расходы Fixed */
  variableShare: number;
  fixed: number;
  cfStress: number;
  dscrStress: number | null;
  /** коэффициент вариации выручки */
  cv: number;
  /** слабый период — только при CV > 0,3 */
  cfWeak?: number;
  dscrWeak?: number | null;
  /** выручка последних 3 мес. / предыдущих 3 мес. */
  trend: number | null;
  /** остаток текущих долгов */
  debtBalance: number;
  /** null — денежный поток ≤ 0, делить нельзя */
  debtCf: number | null;
  cfNegative: boolean;
  /** доля платежа в выручке — справочно, без порога */
  pti: number;
  /** расчётный лимит на запрошенном сроке: авто и ручной (без авто-полномочий) */
  autoLimit: number;
  manualLimit: number;
  calculatedAt: string;
}

export interface Route {
  status: AppStatus;
  /** шаг 0–8, на котором определился маршрут */
  step: number;
  primaryCode: string;
  allCodes: string[];
  /** пояснение с числами по каждому коду */
  details: Record<string, string>;
  /** фраза маршрута: «Серая зона · шаг 6 · G05 — DSCR 1,18 в пограничной зоне 1,1–1,25» */
  summary: string;
}

export interface TraceStep {
  step: number;
  title: string;
  result: 'pass' | 'fired' | 'skipped';
  codes: string[];
  details?: string;
}

/** Вариант условий из поиска контрпредложений (§11). */
export interface Alternative {
  terms: Terms;
  dscr: number | null;
  dscrStress: number | null;
  debtCf: number | null;
  payment: number;
  distance: number;
}

/** Синтетические внешние источники: Федресурс, ФССП, ЗСК, перечни, ФНС, ГИР БО. */
export interface ExternalSources {
  registryStatus: 'active' | 'liquidated' | 'reorganizing' | 'excluded';
  unreliableData: boolean;
  bankruptcy: boolean;
  sanctions: boolean;
  zskRisk: 'low' | 'medium' | 'high';
  fraudConfirmed: boolean;
  directorDisqualified: boolean;
  fnsBlocked: boolean;
  taxDiscipline: 'regular' | 'minor';
  taxDebt: number;
  fsspDebt: number;
  lawsuits: number;
  negativeNetAssets2y: boolean;
  /** выручка по ГИР БО (только ООО) */
  girboRevenue?: number;
  /** выручка по декларации за тот же период */
  declaredRevenue: number;
  checkedAt: string;
}

export type OverdueCategory = 'none' | '1_29' | '30_90' | 'over_90';

/** Кредитная история компании и руководителя (БКИ). */
export interface CreditHistory {
  company: { hasHistory: boolean; worstClosed24m: OverdueCategory; currentOverdueDays: number };
  director: { hasHistory: boolean; worstClosed24m: OverdueCategory; currentOverdueDays: number };
}

/** Снятие мягкого стоп-фактора сотрудником (§13, шаг 4). */
export interface Waiver {
  code: string;
  reasonCode: string;
  /** ссылка на документ заявки или проверку-источник */
  evidence: string;
  comment: string;
  by: string;
  at: string;
}

export interface DecisionDraft {
  type: 'approve' | 'counter_offer';
  /** одобрение на запрошенных условиях, на других (ставка, тип платежа) или контрпредложение */
  variant: 'as_requested' | 'other_terms' | 'counter';
  terms: Terms;
  reasonCode: string;
  validDays: number;
  justification: string;
  clientMessage: string;
}

/** Решение, которое ждёт второго подтверждения (принцип четырёх глаз). */
export interface PendingDecision {
  decision: DecisionDraft;
  initiatorId: string;
  initiatorName: string;
  at: string;
  /** почему нужно второе подтверждение */
  reason: string;
}

export interface Financials {
  /** выручка за 12 мес — предзаполнена из выписки, клиент может поправить */
  revenue12m: number;
  avgTurnover12m: number;
  avgTurnover3m: number;
  /** поступления по месяцам, от старых к новым */
  turnoverByMonth: number[];
  /** из БКИ, клиент может уточнить */
  existingDebt: number;
  existingMonthlyPayments: number;
  existingLoans: number;
  /** долг по данным БКИ — с ним сверяется анкета (D09) */
  bkiDebt?: number;
  overdueCurrent: boolean;
  overdueClosed12m: number;
  /** очищенная выручка Rev_m по месяцам (от старых к новым) */
  revenueByMonth: number[];
  /** денежный поток CF_m по месяцам — кредитные платежи не вычитаются */
  cashflowByMonth: number[];
  /** расходы по статьям за весь период, ₽ */
  expenses: { suppliers: number; payroll: number; taxes: number; rent: number; other: number };
  variableShare: number;
  fixedMonthly: number;
  topBuyerShare: number;
  cashShare: number;
}

export interface Decision {
  type: 'approve' | 'counter_offer' | 'reject';
  variant?: DecisionDraft['variant'];
  terms?: Terms;
  reasonCode?: string;
  /** все коды маршрута, на которых основано решение */
  routeCodes?: string[];
  /** подтвердил второй сотрудник */
  confirmedBy?: string;
  /** внутреннее, видит только банк */
  justification: string;
  /** видит клиент */
  clientMessage: string;
  /** 'system' или ФИО сотрудника */
  decidedBy: string;
  decidedById?: string;
  decidedAt: string;
  validUntil?: string;
}

export interface Recommendation {
  type: 'approve' | 'counter_offer' | 'reject';
  text: string;
  /** 1–3 варианта условий для контрпредложения */
  alternatives: Alternative[];
}

export interface ApplicationChange {
  version: number;
  at: string;
  field: string;
  from: string;
  to: string;
}

export type PipelineStepId = 'registry' | 'sources' | 'bki' | 'statement' | 'scoring' | 'affordability' | 'decision';

export interface PipelineStep {
  id: PipelineStepId;
  title: string;
  status: 'pending' | 'done' | 'fail';
  doneAt?: string;
}

/** Состояние авто-проверок: шаги выполняются по таймеру и переживают перезагрузку. */
export interface PipelineState {
  steps: PipelineStep[];
  nextAt: string;
  /** вкладка, которая сейчас ведёт проверки, и когда она последний раз отметилась */
  owner?: string;
  heartbeat?: string;
}

export interface ContactPerson {
  name: string;
  phone: string;
}

export interface Consents {
  bki: boolean;
  personalData: boolean;
  authority: boolean;
  /** только ИП: согласие на исключительно автоматизированное решение (без него — G08) */
  automated?: boolean;
  at?: string;
}

export interface Application {
  id: string;
  ownerUserId: string;
  company: Company;
  goalId: string;
  subgoalId?: string;
  productId: string;
  requested: Terms;
  indicativeRate: number;
  status: AppStatus;
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
  financials?: Financials;
  documents: DocFile[];
  docRequests: DocRequest[];
  consents: Consents;
  contactPerson?: ContactPerson;
  checks: CheckResult[];
  sources?: ExternalSources;
  creditHistory?: CreditHistory;
  scoring?: Scoring;
  metrics?: Metrics;
  route?: Route;
  trace?: TraceStep[];
  recommendation?: Recommendation;
  waivers?: Waiver[];
  pendingDecision?: PendingDecision;
  /** сколько раз система уже запрашивала сведения */
  needInfoCycle?: number;
  decision?: Decision;
  assigneeId?: string;
  assignedAt?: string;
  slaDueAt?: string;
  messages: Message[];
  history: HistoryEvent[];
  version: number;
  changes: ApplicationChange[];
  changedSinceReview?: boolean;
  /** клиент закрыл запросы документов — сотрудник ещё не посмотрел */
  newDocsForEmployee?: boolean;
  draftStep?: number;
  pipeline?: PipelineState;
  signedAt?: string;
  declineReason?: string;
  issued?: { accountNumber: string; issuedAt: string };
}

export interface User {
  id: string;
  role: Role;
  firstName: string;
  lastName: string;
  /** должность: «Руководитель», «Андеррайтер» */
  position: string;
  email: string;
  phone: string;
  /** клиент: привязанная компания */
  companyInn?: string;
  /** клиент: основание полномочий */
  authority?: string;
}

export interface Account {
  number: string;
  title: string;
  companyInn: string;
}

/** Данные мастера заявки — пока черновик не сохранён как заявка. */
export interface Wizard {
  appId: string | null;
  goalId: string;
  subgoalId?: string;
  requested: Terms;
  step: number;
  company: Company | null;
  companyConfirmed: boolean;
  contactPerson?: ContactPerson;
  financials: Financials | null;
  documents: DocFile[];
  consents: Consents;
  savedAt: string | null;
}

export interface BotMessage {
  id: string;
  from: 'bot' | 'user';
  text: string;
  at: string;
  kind?: 'greeting' | 'upload' | 'file';
  appId?: string;
  /** кнопка загрузки закрывает этот запрос документов */
  requestId?: string;
  links?: { to: string; label: string }[];
}

export interface DbState {
  schema: 3;
  seededAt: string;
  users: User[];
  /** известные компании (кэш реестра для привязанных пользователей) */
  companies: Company[];
  accounts: Account[];
  applications: Application[];
  wizards: Record<string, Wizard>;
  botChats: Record<string, BotMessage[]>;
}
