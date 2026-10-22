import type { Api, ClientChanges, DecisionInput, NewDocFile, RejectInput, RequestItem } from '../api/contracts.ts';
import type { Application, BotMessage, DbState, User, Wizard } from '../domain/types.ts';
import { accountsFor } from '../domain/accounts.ts';
import { clampToProduct, goalById, productForGoal } from '../config/products.ts';
import * as db from './db.ts';
import * as ops from './operations.ts';
import { lookupCompany } from './registry.ts';
import { bkiReport } from './bki.ts';
import { botReply, greeting } from './bot.ts';
import { tickPipelines } from './pipeline.ts';

/** Задержка «сети»: 300–800 мс */
const wait = (min = 300, max = 800) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

const TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}`;

function userOf(state: DbState, userId: string): User {
  const u = state.users.find((x) => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  return u;
}

function appOf(state: DbState, appId: string): Application {
  const a = state.applications.find((x) => x.id === appId);
  if (!a) throw new Error(`Заявка № ${appId} не найдена`);
  return a;
}

const replaceApp = (state: DbState, app: Application): DbState => ({
  ...state,
  applications: state.applications.map((a) => (a.id === app.id ? app : a)),
});

/** Изменить заявку от имени пользователя с проверкой прав. */
function mutate(appId: string, userId: string, fn: (app: Application, user: User, state: DbState) => Application): Application {
  let result!: Application;
  db.update((state) => {
    const user = userOf(state, userId);
    const app = appOf(state, appId);
    if (user.role === 'client' && app.ownerUserId !== user.id) throw new Error('Это не ваша заявка');
    result = fn(app, user, state);
    return result === app ? state : replaceApp(state, result);
  });
  return result;
}

function requireAssignee(app: Application, user: User) {
  if (user.role !== 'employee') throw new Error('Действие доступно только сотруднику банка');
  if (app.assigneeId !== user.id) throw new Error('Сначала возьмите заявку в работу');
}

/* ---------- Мастер заявки ---------- */

function linkedCompany(state: DbState, user: User) {
  const inn = user.companyInn;
  if (!inn) throw new Error('К пользователю не привязана компания');
  return state.companies.find((c) => c.inn === inn) ?? lookupCompany(inn);
}

function defaultWizard(state: DbState, user: User, init: { goalId?: string; subgoalId?: string } = {}): Wizard {
  const goalId = init.goalId ?? 'working';
  const product = productForGoal(goalId);
  const { amount, term } = clampToProduct(product, 2_000_000, 24);
  return {
    appId: null,
    goalId,
    subgoalId: init.subgoalId ?? goalById(goalId).subgoals[0]?.id,
    requested: { amount, term, rate: product.baseRate, paymentType: product.paymentTypes[0] },
    step: 0,
    company: linkedCompany(state, user),
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

function writeWizard(userId: string, fn: (w: Wizard, state: DbState, user: User) => Wizard): Wizard {
  let result!: Wizard;
  db.update((state) => {
    const user = userOf(state, userId);
    const current = state.wizards[userId] ?? defaultWizard(state, user);
    result = normalizeWizard(fn(current, state, user));
    let next: DbState = { ...state, wizards: { ...state.wizards, [userId]: result } };
    // черновик уже сохранён как заявка — обновляем и его, чтобы данные не терялись между шагами
    const draft = result.appId ? next.applications.find((a) => a.id === result.appId && a.status === 'DRAFT') : undefined;
    if (draft) next = replaceApp(next, ops.draftFromWizard(result, user, linkedCompany(state, user), draft.id, new Date(), draft));
    return next;
  });
  return result;
}

export const nextAppId = (apps: Application[]) => String(Math.max(20100, ...apps.map((a) => Number(a.id)).filter(Number.isFinite)) + 1);

/* ---------- Реализация ---------- */

export const mockApi: Api = {
  store: {
    getSnapshot: db.getSnapshot,
    subscribe: db.subscribe,
    async reset() {
      await wait();
      db.reset();
    },
    startBackgroundJobs() {
      const timer = window.setInterval(() => tickPipelines(TAB_ID), 300);
      return () => window.clearInterval(timer);
    },
  },

  applications: {
    getWizard(userId) {
      const state = db.getSnapshot();
      return state.wizards[userId] ?? defaultWizard(state, userOf(state, userId));
    },

    async saveWizard(userId, patch) {
      return writeWizard(userId, (w) => ({ ...w, ...patch, savedAt: new Date().toISOString() }));
    },

    async newWizard(userId, init) {
      return writeWizard(userId, (_w, state, user) => defaultWizard(state, user, init));
    },

    async resumeDraft(userId, appId) {
      await wait(150, 300);
      return writeWizard(userId, (_w, state) => {
        const a = appOf(state, appId);
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
      await wait(200, 400);
      let saved!: Application;
      db.update((state) => {
        const user = userOf(state, userId);
        const w = state.wizards[userId] ?? defaultWizard(state, user);
        const existing = w.appId ? state.applications.find((a) => a.id === w.appId && a.status === 'DRAFT') : undefined;
        const id = existing?.id ?? nextAppId(state.applications);
        saved = ops.draftFromWizard(w, user, linkedCompany(state, user), id, new Date(), existing);
        const applications = existing ? state.applications.map((a) => (a.id === id ? saved : a)) : [saved, ...state.applications];
        return { ...state, applications, wizards: { ...state.wizards, [userId]: { ...w, appId: id, savedAt: saved.updatedAt } } };
      });
      return saved;
    },

    async deleteDraft(userId, appId) {
      await wait();
      db.update((state) => {
        const a = appOf(state, appId);
        if (a.status !== 'DRAFT' || a.ownerUserId !== userId) throw new Error('Удалить можно только свой черновик');
        const wizards = { ...state.wizards };
        if (wizards[userId]?.appId === appId) delete wizards[userId];
        return { ...state, wizards, applications: state.applications.filter((x) => x.id !== appId) };
      });
    },

    async submit(userId) {
      await wait();
      const draft = await mockApi.applications.saveDraft(userId);
      let submitted!: Application;
      db.update((state) => {
        const user = userOf(state, userId);
        const w = state.wizards[userId];
        if (!w?.companyConfirmed) throw new Error('Подтвердите данные компании');
        if (!w.financials) throw new Error('Загрузите выписку по счёту');
        submitted = ops.submit(appOf(state, draft.id), new Date(), ops.actorOf(user));
        const wizards = { ...state.wizards };
        delete wizards[userId];
        return { ...replaceApp(state, submitted), wizards };
      });
      return submitted;
    },

    async startFromApplication(userId, appId) {
      await wait();
      return writeWizard(userId, (_w, state, user) => {
        const a = appOf(state, appId);
        const base = defaultWizard(state, user, { goalId: a.goalId, subgoalId: a.subgoalId });
        return {
          ...base,
          requested: { ...a.requested },
          company: a.company,
          financials: a.financials ?? null,
          savedAt: new Date().toISOString(),
        };
      });
    },

    async updateByClient(appId, userId, changes: ClientChanges) {
      await wait();
      return mutate(appId, userId, (a, u) => ops.updateByClient(a, ops.actorOf(u), changes, new Date()));
    },

    async uploadDocuments(appId, userId, files: NewDocFile[], requestId) {
      await wait();
      return mutate(appId, userId, (a, u) => ops.addDocuments(a, ops.actorOf(u), files, new Date(), requestId));
    },

    async accept(appId, userId) {
      await wait();
      return mutate(appId, userId, (a, u) => ops.acceptOffer(a, ops.actorOf(u), new Date()));
    },

    async decline(appId, userId, reason) {
      await wait();
      return mutate(appId, userId, (a, u) => ops.declineOffer(a, ops.actorOf(u), reason, new Date()));
    },

    async sign(appId, userId) {
      await wait(600, 900);
      return mutate(appId, userId, (a, u) => ops.signDocuments(a, ops.actorOf(u), new Date()));
    },

    async issue(appId, userId, accountNumber) {
      await wait(600, 900);
      return mutate(appId, userId, (a, u, state) => {
        if (!accountsFor(a.company.inn, state.accounts).some((x) => x.number === accountNumber)) throw new Error('Выберите счёт компании');
        return ops.issue(a, ops.actorOf(u), accountNumber, new Date());
      });
    },

    async withdraw(appId, userId) {
      await wait();
      return mutate(appId, userId, (a, u) => ops.withdraw(a, ops.actorOf(u), new Date()));
    },

    async sendMessage(appId, userId, text) {
      await wait(200, 400);
      return mutate(appId, userId, (a, u) => {
        if (u.role === 'employee') requireAssignee(a, u);
        return ops.sendMessage(a, ops.actorOf(u), text, new Date());
      });
    },

    async markSeen(appId, userId) {
      const state = db.getSnapshot();
      const user = state.users.find((x) => x.id === userId);
      const app = state.applications.find((x) => x.id === appId);
      if (!user || !app) return;
      const unread =
        user.role === 'client'
          ? app.messages.some((m) => !m.readByClient) || app.docRequests.some((r) => !r.seenByClient)
          : app.messages.some((m) => !m.readByEmployee);
      if (!unread) return;
      db.update((s) => replaceApp(s, ops.markSeen(appOf(s, appId), user.role)));
    },

    async takeToWork(appId, employeeId) {
      await wait();
      return mutate(appId, employeeId, (a, u) => {
        if (u.role !== 'employee') throw new Error('Действие доступно только сотруднику банка');
        return ops.takeToWork(a, ops.actorOf(u), new Date());
      });
    },

    async requestDocuments(appId, employeeId, items: RequestItem[], dueAt) {
      await wait();
      return mutate(appId, employeeId, (a, u) => {
        requireAssignee(a, u);
        return ops.requestDocuments(a, ops.actorOf(u), items, new Date(dueAt), new Date());
      });
    },

    async decide(appId, employeeId, input: DecisionInput) {
      await wait();
      return mutate(appId, employeeId, (a, u) => {
        requireAssignee(a, u);
        return ops.makeDecision(a, ops.actorOf(u), input, new Date());
      });
    },

    async reject(appId, employeeId, input: RejectInput) {
      await wait();
      return mutate(appId, employeeId, (a, u) => {
        requireAssignee(a, u);
        return ops.rejectApplication(a, ops.actorOf(u), input, new Date());
      });
    },

    async acknowledgeChanges(appId, employeeId) {
      await wait(200, 400);
      return mutate(appId, employeeId, (a, u) => {
        requireAssignee(a, u);
        return ops.acknowledgeChanges(a, ops.actorOf(u), new Date());
      });
    },

    async rescore(appId, employeeId) {
      await wait(500, 800);
      return mutate(appId, employeeId, (a, u) => {
        requireAssignee(a, u);
        return ops.rescore(a, new Date(), ops.actorOf(u));
      });
    },

    async clearNewDocs(appId, employeeId) {
      const app = db.getSnapshot().applications.find((a) => a.id === appId);
      if (!app?.newDocsForEmployee || app.assigneeId !== employeeId) return;
      mutate(appId, employeeId, (a) => ({ ...a, newDocsForEmployee: false }));
    },
  },

  registry: {
    async lookup(inn) {
      await wait(400, 800);
      return lookupCompany(inn.trim());
    },
  },

  bki: {
    async report(inn) {
      await wait();
      return bkiReport(inn);
    },
  },

  statement: {
    async prefill(inn) {
      await wait(600, 900);
      return ops.prefillFinancials(inn);
    },
  },

  chat: {
    getMessages(userId) {
      const state = db.getSnapshot();
      const saved = state.botChats[userId];
      if (saved?.length) return saved;
      const user = state.users.find((u) => u.id === userId);
      return [{ id: 'greeting', from: 'bot', at: state.seededAt, ...greeting(user?.firstName ?? '') }];
    },

    async ask(userId, text) {
      const userMsg: BotMessage = { id: ops.uid('bot'), from: 'user', text: text.trim(), at: new Date().toISOString() };
      appendChat(userId, [userMsg]);
      await wait(600, 900);
      const reply = botReply(text, db.getSnapshot(), userId);
      const botMsg: BotMessage = { id: ops.uid('bot'), from: 'bot', at: new Date().toISOString(), ...reply };
      return appendChat(userId, [botMsg]);
    },

    async attachFile(userId, file, appId, requestId) {
      if (appId) await mockApi.applications.uploadDocuments(appId, userId, [file], requestId);
      else await wait();
      const app = appId ? db.getSnapshot().applications.find((a) => a.id === appId) : undefined;
      const msgs: BotMessage[] = [{ id: ops.uid('bot'), from: 'user', kind: 'file', text: file.name, appId, at: new Date().toISOString() }];
      msgs.push({
        id: ops.uid('bot'),
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
  },
};

function appendChat(userId: string, messages: BotMessage[]): BotMessage[] {
  let all: BotMessage[] = [];
  db.update((state) => {
    const current = state.botChats[userId]?.length ? state.botChats[userId] : mockApi.chat.getMessages(userId);
    all = [...current, ...messages];
    return { ...state, botChats: { ...state.botChats, [userId]: all } };
  });
  return all;
}

