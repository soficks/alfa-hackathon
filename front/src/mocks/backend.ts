import type { Account, Application, DbState, PaymentType, Scoring, User } from '../domain/types.ts';
import * as db from './db.ts';
import { registerCompany, type RegistryRecord } from './registry.ts';
import { registerBki, type BkiReport } from './bki.ts';
import { registerStatement } from './statement.ts';
import { SYSTEM } from './operations.ts';

/**
 * Связь с FastAPI-бэкендом (backend/main.py).
 * Бэкенд — источник демо-профилей (ФНС, БКИ, DWH) и итогового решения по заявке.
 * Если он недоступен, кабинет работает на локальных моках, как раньше.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const BACKEND_URL = (env?.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export type BackendScenario = 'APPROVED' | 'COUNTER_OFFER' | 'NEED_INFO' | 'REJECTED';

export interface BackendProfile {
  inn: string;
  scenario: BackendScenario | null;
  registry: RegistryRecord;
  bki: BkiReport;
  statement: { monthlyTurnover: number; change3m: number };
}

export interface BackendOffer {
  id: string;
  title: string;
  amount: number;
  term: number;
  rate: number;
  paymentType: PaymentType;
  graceMonths: number;
  monthlyPayment: number;
  pti: number;
}

/** Скоринг бэкенда: балльная модель в форме Scoring фронта плюс расчёт PTI */
export interface BackendScoring extends Scoring {
  confirmedTurnover: number;
  debtServiceCapacity: number;
  currentMonthlyPayments: number;
  newMonthlyPayment: number;
  pti: number;
}

export interface BackendDecision {
  id: string;
  status: BackendScenario;
  reasonCode: string | null;
  reasonText: string | null;
  amount: number;
  term: number;
  rate: number;
  paymentType: PaymentType;
  graceMonths: number;
  scoring: BackendScoring | null;
  offers: BackendOffer[];
  checks: { stage: string; name: string; passed: boolean; details: string }[];
}

let profiles: BackendProfile[] = [];

export const isBackendOnline = () => profiles.length > 0;
export const backendProfileOf = (inn?: string) => profiles.find((p) => p.inn === inn);
/** Бэкенд знает только свои профили — остальные компании оценивает локальная модель */
export const handledByBackend = (app: Application) => !!backendProfileOf(app.company.inn);

async function http<T>(path: string, init?: RequestInit, timeoutMs = 5000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
      throw new Error(typeof body?.detail === 'string' ? body.detail : `Бэкенд ответил ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const demoUserId = (inn: string) => `u-demo-${inn}`;

function demoUser(p: BackendProfile): User {
  const [lastName, firstName = ''] = p.registry.head.split(' ');
  return {
    id: demoUserId(p.inn),
    role: 'client',
    firstName,
    lastName,
    position: p.inn.length === 12 ? 'Индивидуальный предприниматель' : 'Генеральный директор',
    email: `demo-${p.inn}@example.com`,
    phone: '+7 999 000-00-00',
    companyInn: p.inn,
    authority: p.inn.length === 12 ? 'Предприниматель, действует от своего имени' : 'Генеральный директор, действует на основании устава',
  };
}

const demoAccount = (p: BackendProfile): Account => ({
  number: `407028104${p.inn.slice(-11).padStart(11, '0')}`,
  title: 'Расчётный счёт',
  companyInn: p.inn,
});

/** Добавить в хранилище демо-клиентов и их счета (идемпотентно, переживает reset). */
export function ensureDemoUsers() {
  if (!profiles.length) return;
  db.update((state): DbState => {
    const users = profiles.map(demoUser).filter((u) => !state.users.some((x) => x.id === u.id));
    const accounts = profiles.map(demoAccount).filter((a) => !state.accounts.some((x) => x.number === a.number));
    if (!users.length && !accounts.length) return state;
    return { ...state, users: [...state.users, ...users], accounts: [...state.accounts, ...accounts] };
  });
}

/** Забрать профили с бэкенда и подложить их в моки реестра, БКИ и выписки. */
export async function connectBackend(): Promise<boolean> {
  try {
    profiles = await http<BackendProfile[]>('/api/profiles', undefined, 2500);
  } catch (e) {
    console.warn(`Бэкенд ${BACKEND_URL} недоступен — работаем на локальных моках`, e);
    profiles = [];
    return false;
  }
  for (const p of profiles) {
    registerCompany(p.registry);
    registerBki(p.bki);
    registerStatement(p.inn, p.statement.monthlyTurnover, p.statement.change3m);
  }
  ensureDemoUsers();
  return true;
}

/** Выписку из другого банка по запросу системы уже загрузили */
export const hasExternalStatement = (app: Application) =>
  app.docRequests.some((r) => r.createdBy === SYSTEM.name && r.docType === 'bank_statement' && r.fulfilledByDocId);

/** Прогнать заявку через конвейер бэкенда: Gatekeeper → Quality Check → Brain (балл, PTI) → Solver. */
export function requestDecision(app: Application): Promise<BackendDecision> {
  const { amount, term, paymentType, graceMonths } = app.requested;
  return http<BackendDecision>('/api/applications', {
    method: 'POST',
    body: JSON.stringify({
      inn: app.company.inn,
      amount,
      term,
      product: app.productId,
      paymentType,
      graceMonths: paymentType === 'annuity_grace' ? (graceMonths ?? 0) : 0,
      externalStatement: hasExternalStatement(app),
    }),
  });
}
