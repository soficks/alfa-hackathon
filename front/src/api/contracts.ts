import type {
  Application,
  BotMessage,
  Company,
  DbState,
  DocFile,
  DocType,
  Financials,
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

export interface DecisionInput {
  type: 'approve' | 'counter_offer';
  terms: Terms;
  validDays: number;
  justification: string;
  clientMessage: string;
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
}

export interface RegistryApi {
  lookup(inn: string): Promise<Company>;
}

export interface BkiReport {
  inn: string;
  loans: number;
  totalDebt: number;
  monthlyPayments: number;
  overdueCurrent: boolean;
  overdueClosed12m: number;
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
