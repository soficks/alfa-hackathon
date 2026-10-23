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
}

export interface DocRequest {
  id: string;
  docType: DocType;
  comment: string;
  dueAt: string;
  createdAt: string;
  createdBy: string;
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
  id: 'registry' | 'bki' | 'requisites' | 'documents';
  status: 'ok' | 'warn' | 'fail';
  title: string;
  details: string[];
}

export interface ScoringFactor {
  id: string;
  title: string;
  value: string;
  points: number;
  explanation: string;
}

export interface StopFactor {
  /** код причины отказа из config/rejectReasons */
  code: string;
  text: string;
}

export type ScoreZone = 'high_risk' | 'manual' | 'auto';

export interface Scoring {
  score: number;
  base: number;
  zone: ScoreZone;
  factors: ScoringFactor[];
  stopFactors: StopFactor[];
  calculatedAt: string;
  /** версия правил, по которой считали; пересчёты заявки идут по той же версии */
  modelVersion?: string;
  /** показатель долговой нагрузки (PTI) и его слагаемые — считает сервер */
  pti?: number;
  confirmedTurnover?: number;
  debtServiceCapacity?: number;
  currentMonthlyPayments?: number;
  newMonthlyPayment?: number;
}

/** Строка истории расчётов скоринга: что и по каким условиям пересчитывали */
export interface ScoringRun {
  id: string;
  calculatedAt: string;
  /** checks — авто-проверки, client_changed — клиент поменял условия, documents — загрузил документы, employee — пересчёт сотрудником */
  trigger: 'checks' | 'client_changed' | 'documents' | 'employee';
  modelVersion: string;
  score: number;
  pti: number | null;
  zone: ScoreZone;
  outcome: string;
  amount: number;
  term: number;
  paymentType: PaymentType;
  rate: number;
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
  overdueCurrent: boolean;
  overdueClosed12m: number;
}

export interface Decision {
  type: 'approve' | 'counter_offer' | 'reject';
  terms?: Terms;
  reasonCode?: string;
  /** варианты автоматического встречного предложения (первый — основной) */
  offers?: { id: string; title: string; amount: number; term: number; rate: number; paymentType: PaymentType; graceMonths: number; monthlyPayment: number; pti: number }[];
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
  amount?: number;
  /** почему система не приняла решение сама */
  manualReasons: string[];
}

export interface ApplicationChange {
  version: number;
  at: string;
  field: string;
  from: string;
  to: string;
}

export type PipelineStepId = 'registry' | 'bki' | 'statement' | 'scoring' | 'decision';

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
  scoring?: Scoring;
  recommendation?: Recommendation;
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
  /** версия правил скоринга, фиксируется при создании заявки */
  modelVersion?: string;
  /** все расчёты скоринга по заявке, от первого к последнему */
  scoringHistory?: ScoringRun[];
  /** поля записи заявки на сервере */
  applicationId?: string;
  clientId?: string;
  companyInn?: string;
  assignedEmployeeId?: string;
  requestedTerms?: { productId: string; amount: number; term: number };
  scoringResult?: { score: number; pti: number | null; modelVersion: string };
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
