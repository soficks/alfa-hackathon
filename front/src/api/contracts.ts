import type {
  Application,
  BotMessage,
  Company,
  DbState,
  DecisionDraft,
  DocFile,
  DocType,
  Financials,
  Metrics,
  OverdueCategory,
  Terms,
  Wizard,
} from '../domain/types';

/**
 * Интерфейсы «серверной» части. Сейчас реализованы моками (src/mocks),
 * позже заменяются HTTP-клиентом без изменения экранов.
 */

export type NewDocFile = Omit<DocFile, 'source' | 'addedBy'>;

export interface RequestItem {
  docType: DocType;
  comment: string;
}

/** Решение сотрудника: тип, вариант, условия, код причины, обоснование */
export type DecisionInput = DecisionDraft;

/** Расчёт для формы решения: метрики на выбранных условиях и запреты политики */
export interface TermsPreview {
  metrics: Metrics;
  blockers: string[];
  /** расчётный лимит + 10% */
  maxAllowed: number;
}

export interface WaiverInput {
  code: string;
  reasonCode: string;
  evidence: string;
  comment: string;
}

export interface RejectInput {
  reasonCode: string;
  justification: string;
  clientMessage: string;
}

export interface ClientChanges {
  requested?: Partial<Pick<Terms, 'amount' | 'term' | 'paymentType' | 'graceMonths'>>;
  financials?: Partial<Pick<Financials, 'revenue12m' | 'existingDebt' | 'existingMonthlyPayments'>>;
}

export interface StoreApi {
  /** текущее состояние (синхронно, для подписки React) */
  getSnapshot(): DbState;
  subscribe(listener: () => void): () => void;
  reset(): Promise<void>;
  /** фоновые задачи сервера (в моке — авто-проверки); возвращает функцию остановки */
  startBackgroundJobs(): () => void;
}

export interface ApplicationsApi {
  /* мастер заявки */
  getWizard(userId: string): Wizard;
  saveWizard(userId: string, patch: Partial<Wizard>): Promise<Wizard>;
  newWizard(userId: string, init?: { goalId?: string; subgoalId?: string }): Promise<Wizard>;
  resumeDraft(userId: string, appId: string): Promise<Wizard>;
  saveDraft(userId: string): Promise<Application>;
  deleteDraft(userId: string, appId: string): Promise<void>;
  submit(userId: string): Promise<Application>;
  /** новая заявка после отказа: цель, компания и финансы переносятся */
  startFromApplication(userId: string, appId: string): Promise<Wizard>;

  /* клиент после отправки */
  updateByClient(appId: string, userId: string, changes: ClientChanges): Promise<Application>;
  uploadDocuments(appId: string, userId: string, files: NewDocFile[], requestId?: string): Promise<Application>;
  accept(appId: string, userId: string): Promise<Application>;
  decline(appId: string, userId: string, reason: string): Promise<Application>;
  sign(appId: string, userId: string): Promise<Application>;
  issue(appId: string, userId: string, accountNumber: string): Promise<Application>;
  withdraw(appId: string, userId: string): Promise<Application>;

  /* переписка */
  sendMessage(appId: string, userId: string, text: string): Promise<Application>;
  markSeen(appId: string, userId: string): Promise<void>;

  /* сотрудник */
  takeToWork(appId: string, employeeId: string): Promise<Application>;
  requestDocuments(appId: string, employeeId: string, items: RequestItem[], dueAt: string): Promise<Application>;
  decide(appId: string, employeeId: string, input: DecisionInput): Promise<Application>;
  reject(appId: string, employeeId: string, input: RejectInput): Promise<Application>;
  acknowledgeChanges(appId: string, employeeId: string): Promise<Application>;
  rescore(appId: string, employeeId: string): Promise<Application>;
  clearNewDocs(appId: string, employeeId: string): Promise<void>;
  /** пересчёт метрик и запретов на других условиях — без сохранения (POST /simulate) */
  preview(appId: string, terms: Terms): TermsPreview;
  waiveSoftStop(appId: string, employeeId: string, input: WaiverInput): Promise<Application>;
  remind(appId: string, employeeId: string): Promise<Application>;
  /** второе подтверждение решения другим сотрудником */
  confirmDecision(appId: string, employeeId: string): Promise<Application>;
  returnDecision(appId: string, employeeId: string, comment: string): Promise<Application>;
}

export interface RegistryApi {
  lookup(inn: string): Promise<Company>;
}

export interface BkiReport {
  inn: string;
  loans: number;
  totalDebt: number;
  monthlyPayments: number;
  currentOverdueDays: number;
  worstClosed24m: OverdueCategory;
  hasHistory: boolean;
  director: { hasHistory: boolean; worstClosed24m: OverdueCategory; currentOverdueDays: number };
}

export interface BkiApi {
  report(inn: string): Promise<BkiReport>;
}

export interface StatementApi {
  /** финансы по выписке и БКИ для предзаполнения мастера */
  prefill(inn: string): Promise<Financials>;
}

export interface ChatApi {
  getMessages(userId: string): BotMessage[];
  ask(userId: string, text: string): Promise<BotMessage[]>;
  attachFile(userId: string, file: NewDocFile, appId?: string, requestId?: string): Promise<void>;
}

export interface Api {
  store: StoreApi;
  applications: ApplicationsApi;
  registry: RegistryApi;
  bki: BkiApi;
  statement: StatementApi;
  chat: ChatApi;
}
