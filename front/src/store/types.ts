import type { CompanyFields } from '../utils/finance';

export type GoalId = 'working' | 'equipment' | 'growth';

/** Состояния заявки — как в стейт-машине backend. */
export type AppStatus = 'DRAFT' | 'SUBMITTED' | 'NEED_INFO' | 'MANUAL_REVIEW' | 'APPROVED' | 'COUNTER_OFFER';

export type Company = CompanyFields;

export interface DocFile {
  id: string;
  name: string;
  size: number;
  addedAt: string;
  demo?: boolean;
}

export interface HistoryEvent {
  date: string;
  text: string;
}

export interface Terms {
  amount: number;
  term: number;
  /** % годовых */
  rate: number;
}

export interface Application extends Terms {
  id: string;
  goal: GoalId;
  option: number;
  status: AppStatus;
  createdAt: string;
  updatedAt: string;
  company: Company;
  revenue: string;
  tax: string;
  documents: DocFile[];
  history: HistoryEvent[];
  /** Шаг мастера, на котором остановился черновик */
  step?: number;
  /** Что запросил банк в статусе NEED_INFO */
  request?: string;
  /** Встречное предложение банка (COUNTER_OFFER) */
  offer?: Terms;
  /** Клиент принял условия — кредит выдан */
  accepted?: boolean;
}

/** Данные мастера «Финансирование». Хранятся отдельно, пока черновик не сохранён. */
export interface Wizard {
  appId: string | null;
  goal: GoalId;
  option: number;
  amount: number;
  term: number;
  step: number;
  company: Company;
  revenue: string;
  tax: string;
  documents: DocFile[];
  savedAt: string | null;
}

export type ChatAuthor = 'bot' | 'user' | 'operator' | 'system';

export interface ChatMessage {
  id: string;
  from: ChatAuthor;
  text: string;
  time: string;
  /** greeting — с быстрыми вопросами; upload — с кнопкой загрузки; file — карточка файла */
  kind?: 'greeting' | 'upload' | 'file';
  appId?: string;
}

export interface User {
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
}

export interface State {
  authed: boolean;
  user: User;
  company: Company;
  wizard: Wizard;
  applications: Application[];
  chat: ChatMessage[];
  chatMode: 'bot' | 'operator';
}
