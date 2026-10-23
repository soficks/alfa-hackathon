import type { Api, ApplicationsApi, ChatApi, ClientChanges, DecisionInput, NewDocFile, RejectInput, RequestItem } from './contracts.ts';
import type { Application, BotMessage, Company, DbState, User, Wizard } from '../domain/types.ts';
import { clampToProduct, goalById, productForGoal } from '../config/products.ts';
import { botReply, greeting } from '../mocks/bot.ts';

/**
 * HTTP-клиент FastAPI-бэкенда (backend/main.py). Заявки, черновики, документы, статусы, решения и история
 * живут на сервере в SQLite; здесь только кэш для React (useSyncExternalStore) и вызовы по applicationId.
 * Единственное, что осталось локальным, — переписка с ботом-помощником (моки, src/mocks/bot.ts).
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const BACKEND_URL = (env?.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

const BOT_KEY = 'business-cabinet-bot-v1';

/** Кто делает запросы: сервер пишет это в журнал запросов и проверяет права. Демо-режим — без паролей. */
let actor: string | null = null;

/* ---------- HTTP ---------- */

async function http<T>(path: string, opts: { method?: string; body?: unknown; userId?: string; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      signal: ctrl.signal,
      headers: { ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(opts.userId ?? actor ? { 'X-User-Id': (opts.userId ?? actor) as string } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { detail?: unknown } | null;
      throw new Error(typeof data?.detail === 'string' ? data.detail : `Сервер ответил ${res.status}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  } catch (e) {
    if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) throw new Error(`Сервер ${BACKEND_URL} недоступен. Запустите бэкенд: uvicorn main:app --port 8000`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Кэш состояния ---------- */

interface ServerState {
  revision: number;
  seededAt: string;
  users: User[];
  companies: Company[];
  accounts: DbState['accounts'];
  applications: Application[];
  wizards: Record<string, Wizard>;
}

const EMPTY: DbState = { schema: 3, seededAt: new Date().toISOString(), users: [], companies: [], accounts: [], applications: [], wizards: {}, botChats: {} };

let state: DbState = EMPTY;
let revision = -1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const setState = (next: DbState) => {
  state = next;
  emit();
};

function readBotChats(): Record<string, BotMessage[]> {
  try {
    return JSON.parse(localStorage.getItem(BOT_KEY) ?? '{}') as Record<string, BotMessage[]>;
  } catch {
    return {};
  }
}

function writeBotChats(chats: Record<string, BotMessage[]>) {
  try {
    localStorage.setItem(BOT_KEY, JSON.stringify(chats));
  } catch {
    /* приватный режим — переписка с ботом живёт до перезагрузки */
  }
}

/** Забрать с сервера всё состояние. Черновики мастера берём только при первой загрузке и сбросе. */
async function load(withWizards: boolean): Promise<void> {
  const s = await http<ServerState>('/api/state');
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  revision = s.revision;
  setState({
    ...state,
    seededAt: s.seededAt,
    users: same(state.users, s.users) ? state.users : s.users,
    companies: same(state.companies, s.companies) ? state.companies : s.companies,
    accounts: same(state.accounts, s.accounts) ? state.accounts : s.accounts,
    applications: same(state.applications, s.applications) ? state.applications : s.applications,
    wizards: withWizards ? s.wizards : state.wizards,
    botChats: withWizards ? readBotChats() : state.botChats,
  });
}

/** Свежая заявка из ответа сервера — сразу в кэш, не дожидаясь опроса. */
function putApp(app: Application): Application {
  const exists = state.applications.some((a) => a.id === app.id);
  setState({ ...state, applications: exists ? state.applications.map((a) => (a.id === app.id ? app : a)) : [app, ...state.applications] });
  return app;
}

const userOf = (userId: string): User => {
  const u = state.users.find((x) => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  return u;
};

const appOf = (appId: string): Application => {
  const a = state.applications.find((x) => x.id === appId);
  if (!a) throw new Error(`Заявка № ${appId} не найдена`);
  return a;
};

/* ---------- Профили демо-клиентов ---------- */

export type BackendScenario = 'APPROVED' | 'COUNTER_OFFER' | 'NEED_INFO' | 'REJECTED';

export interface BackendProfile {
  inn: string;
  scenario: BackendScenario | null;
  registry: Company;
}

let profiles: BackendProfile[] = [];
export const backendProfileOf = (inn?: string) => profiles.find((p) => p.inn === inn);

/* ---------- Мастер заявки ---------- */

function defaultWizard(user: User, init: { goalId?: string; subgoalId?: string } = {}): Wizard {
  const goalId = init.goalId ?? 'working';
  const product = productForGoal(goalId);
  const { amount, term } = clampToProduct(product, 2_000_000, 24);
  return {
    appId: null,
    goalId,
    subgoalId: init.subgoalId ?? goalById(goalId).subgoals[0]?.id,
    requested: { amount, term, rate: product.baseRate, paymentType: product.paymentTypes[0] },
    step: 0,
    company: state.companies.find((c) => c.inn === user.companyInn) ?? null,
    companyConfirmed: false,
    financials: null,
    documents: [],
    consents: { bki: false, personalData: false, authority: false },
    savedAt: null,
  };
}

/** Привести условия к продукту выбранной цели (при смене цели меняются лимиты). */
function normalizeWizard(w: Wizard): Wizard {
  const product = productForGoal(w.goalId);
  const { amount, term } = clampToProduct(product, w.requested.amount, w.requested.term);
  const paymentType = product.paymentTypes.includes(w.requested.paymentType) ? w.requested.paymentType : product.paymentTypes[0];
  const graceMonths = paymentType === 'annuity_grace' ? Math.min(product.maxGraceMonths ?? 0, Math.max(1, w.requested.graceMonths ?? 1)) : undefined;
  const subgoals = goalById(w.goalId).subgoals;
  return {
    ...w,
    subgoalId: subgoals.some((s) => s.id === w.subgoalId) ? w.subgoalId : subgoals[0]?.id,
    requested: { amount, term, paymentType, graceMonths, rate: product.baseRate },
  };
}

/** Записи мастера на сервер идут по очереди: порядок шагов не теряется, ошибка одной не ломает остальные. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(userId: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(userId) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(userId, run);
  return run;
}
const flush = (userId: string) => (queues.get(userId) ?? Promise.resolve()).catch(() => undefined);

function setWizard(userId: string, wizard: Wizard): Wizard {
  setState({ ...state, wizards: { ...state.wizards, [userId]: wizard } });
  // сервер сохраняет мастер и заодно обновляет черновик заявки
  void enqueue(userId, async () => {
    await http('/api/users/' + userId + '/wizard', { method: 'PUT', body: wizard, userId });
    if (wizard.appId && state.applications.some((a) => a.id === wizard.appId && a.status === 'DRAFT')) {
      putApp(await http<Application>(`/api/applications/${wizard.appId}`, { userId }));
    }
  }).catch((e) => console.warn('Не удалось сохранить мастер заявки на сервере', e));
  return wizard;
}

const writeWizard = (userId: string, fn: (w: Wizard, user: User) => Wizard): Wizard => {
  const user = userOf(userId);
  return setWizard(userId, normalizeWizard(fn(state.wizards[userId] ?? defaultWizard(user), user)));
};

const draftPayload = (w: Wizard) => ({
  goalId: w.goalId,
  subgoalId: w.subgoalId,
  requested: w.requested,
  step: w.step,
  company: w.company,
  financials: w.financials,
  documents: w.documents,
  consents: w.consents,
  contactPerson: w.contactPerson,
});

/* ---------- Заявки ---------- */

const post = (appId: string, userId: string, path: string, body?: unknown) =>
  http<Application>(`/api/applications/${appId}/${path}`, { method: 'POST', body: body ?? {}, userId }).then(putApp);

const applications: ApplicationsApi = {
  getWizard(userId) {
    return state.wizards[userId] ?? defaultWizard(userOf(userId));
  },

  async saveWizard(userId, patch) {
    return writeWizard(userId, (w) => ({ ...w, ...patch, savedAt: new Date().toISOString() }));
  },

  async newWizard(userId, init) {
    return writeWizard(userId, (_w, user) => defaultWizard(user, init));
  },

  async resumeDraft(userId, appId) {
    return writeWizard(userId, () => {
      const a = appOf(appId);
      if (a.status !== 'DRAFT' || a.ownerUserId !== userId) throw new Error('Черновик не найден');
      return {
        appId: a.id,
        goalId: a.goalId,
        subgoalId: a.subgoalId,
        requested: a.requested,
        step: a.draftStep ?? 0,
        company: a.company,
        companyConfirmed: (a.draftStep ?? 0) > 1,
        contactPerson: a.contactPerson,
        financials: a.financials ?? null,
        documents: a.documents,
        consents: a.consents,
        savedAt: a.updatedAt,
      };
    });
  },

  async saveDraft(userId) {
    await flush(userId);
    const w = state.wizards[userId] ?? defaultWizard(userOf(userId));
    const existing = w.appId ? state.applications.find((a) => a.id === w.appId && a.status === 'DRAFT') : undefined;
    const saved = existing
      ? await http<Application>(`/api/applications/${existing.id}`, { method: 'PATCH', body: draftPayload(w), userId })
      : await http<Application>('/api/applications', { method: 'POST', body: draftPayload(w), userId });
    putApp(saved);
    if (w.appId !== saved.id) setWizard(userId, { ...w, appId: saved.id, savedAt: saved.updatedAt });
    return saved;
  },

  async deleteDraft(userId, appId) {
    await flush(userId);
    await http(`/api/applications/${appId}`, { method: 'DELETE', userId });
    const wizards = { ...state.wizards };
    if (wizards[userId]?.appId === appId) delete wizards[userId];
    setState({ ...state, wizards, applications: state.applications.filter((a) => a.id !== appId) });
  },

  async submit(userId) {
    const w = state.wizards[userId];
    if (!w?.companyConfirmed) throw new Error('Подтвердите данные компании');
    if (!w.financials) throw new Error('Загрузите выписку по счёту');
    const draft = await applications.saveDraft(userId);
    await flush(userId);
    const submitted = await post(draft.id, userId, 'submit');
    const wizards = { ...state.wizards };
    delete wizards[userId];
    setState({ ...state, wizards });
    return submitted;
  },

  async startFromApplication(userId, appId) {
    return writeWizard(userId, (_w, user) => {
      const a = appOf(appId);
      return {
        ...defaultWizard(user, { goalId: a.goalId, subgoalId: a.subgoalId }),
        requested: { ...a.requested },
        company: a.company,
        financials: a.financials ?? null,
        savedAt: new Date().toISOString(),
      };
    });
  },

  updateByClient: (appId, userId, changes: ClientChanges) =>
    http<Application>(`/api/applications/${appId}`, { method: 'PATCH', body: changes, userId }).then(putApp),

  async uploadDocuments(appId, userId, files: NewDocFile[], requestId) {
    if (!files.length) return appOf(appId);
    return post(appId, userId, 'documents', { files, requestId });
  },

  accept: (appId, userId) => post(appId, userId, 'client-response', { action: 'accept' }),
  decline: (appId, userId, reason) => post(appId, userId, 'client-response', { action: 'decline', reason }),
  sign: (appId, userId) => post(appId, userId, 'client-response', { action: 'sign' }),
  issue: (appId, userId, accountNumber) => post(appId, userId, 'client-response', { action: 'issue', accountNumber }),
  withdraw: (appId, userId) => post(appId, userId, 'client-response', { action: 'withdraw' }),

  sendMessage: (appId, userId, text) => post(appId, userId, 'messages', { text }),

  async markSeen(appId, userId) {
    const user = state.users.find((x) => x.id === userId);
    const app = state.applications.find((x) => x.id === appId);
    if (!user || !app) return;
    const unread =
      user.role === 'client'
        ? app.messages.some((m) => !m.readByClient) || app.docRequests.some((r) => !r.seenByClient)
        : app.messages.some((m) => !m.readByEmployee);
    if (unread) await post(appId, userId, 'seen').catch(() => undefined);
  },

  takeToWork: (appId, employeeId) => post(appId, employeeId, 'take'),
  requestDocuments: (appId, employeeId, items: RequestItem[], dueAt) => post(appId, employeeId, 'document-requests', { items, dueAt }),
  decide: (appId, employeeId, input: DecisionInput) =>
    post(appId, employeeId, 'decision', { type: input.type, terms: input.terms, validDays: input.validDays, justification: input.justification, clientMessage: input.clientMessage }),
  reject: (appId, employeeId, input: RejectInput) => post(appId, employeeId, 'decision', { type: 'reject', ...input }),
  acknowledgeChanges: (appId, employeeId) => post(appId, employeeId, 'acknowledge-changes'),
  rescore: (appId, employeeId) => post(appId, employeeId, 'rescore'),

  async clearNewDocs(appId, employeeId) {
    const app = state.applications.find((a) => a.id === appId);
    if (!app?.newDocsForEmployee || app.assigneeId !== employeeId) return;
    await post(appId, employeeId, 'clear-new-docs').catch(() => undefined);
  },
};

/* ---------- Помощник (моки) ---------- */

function appendChat(userId: string, messages: BotMessage[]): BotMessage[] {
  const all = [...chat.getMessages(userId), ...messages];
  const botChats = { ...state.botChats, [userId]: all };
  writeBotChats(botChats);
  setState({ ...state, botChats });
  return all;
}

const wait = (min: number, max: number) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const botId = () => `bot-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const chat: ChatApi = {
  getMessages(userId) {
    const saved = state.botChats[userId];
    if (saved?.length) return saved;
    const user = state.users.find((u) => u.id === userId);
    return [{ id: 'greeting', from: 'bot', at: state.seededAt, ...greeting(user?.firstName ?? '') }];
  },

  async ask(userId, text) {
    appendChat(userId, [{ id: botId(), from: 'user', text: text.trim(), at: new Date().toISOString() }]);
    await wait(600, 900);
    return appendChat(userId, [{ id: botId(), from: 'bot', at: new Date().toISOString(), ...botReply(text, state, userId) }]);
  },

  async attachFile(userId, file, appId, requestId) {
    if (appId) await applications.uploadDocuments(appId, userId, [file], requestId);
    const app = appId ? state.applications.find((a) => a.id === appId) : undefined;
    const msgs: BotMessage[] = [{ id: botId(), from: 'user', kind: 'file', text: file.name, appId, at: new Date().toISOString() }];
    msgs.push({
      id: botId(),
      from: 'bot',
      at: new Date().toISOString(),
      text: app
        ? app.status === 'IN_REVIEW'
          ? `Спасибо! Документ прикреплён к заявке № ${app.id}, все запросы закрыты — заявка снова у специалиста.`
          : `Документ прикреплён к заявке № ${app.id}.`
        : 'Файл получен, но он не привязан к заявке. Загрузите его в карточке нужной заявки.',
      links: app ? [{ to: `/applications/${app.id}`, label: `Открыть заявку № ${app.id}` }] : undefined,
    });
    appendChat(userId, msgs);
  },
};

/* ---------- Api ---------- */

export const api: Api = {
  store: {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setActor(userId) {
      actor = userId;
    },

    async load() {
      await load(true);
      profiles = await http<BackendProfile[]>('/api/profiles').catch(() => []);
    },

    async reset() {
      await http('/api/reset', { method: 'POST', body: {} });
      writeBotChats({});
      await load(true);
    },

    /** Опрос сервера: счётчик изменений дешёвый, полное состояние тянем, только если он сдвинулся. */
    startBackgroundJobs() {
      let stopped = false;
      let timer: number | undefined;
      const poll = async () => {
        if (!document.hidden) {
          try {
            const { revision: rev } = await http<{ revision: number }>('/api/revision', { timeoutMs: 3000 });
            if (rev !== revision) await load(false);
          } catch {
            /* сервер временно недоступен — повторим */
          }
        }
        if (!stopped) timer = window.setTimeout(poll, state.applications.some((a) => a.status === 'SUBMITTED' || a.status === 'AUTO_CHECKS') ? 500 : 1500);
      };
      timer = window.setTimeout(poll, 800);
      return () => {
        stopped = true;
        window.clearTimeout(timer);
      };
    },
  },

  applications,

  registry: { lookup: (inn) => http<Company>(`/api/registry/${encodeURIComponent(inn.trim())}`) },
  bki: { report: (inn) => http(`/api/bki/${encodeURIComponent(inn)}`) },
  statement: { prefill: (inn) => http(`/api/statement/${encodeURIComponent(inn)}`) },
  chat,
};
