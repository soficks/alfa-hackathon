import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { DEMO_COMPANY, EMPTY_COMPANY, canTransition, needsAction, seedApplications } from './data';
import type { Application, AppStatus, ChatMessage, DocFile, GoalId, State, Terms, Wizard } from './types';
import { DEMO_RATE } from '../utils/finance';
import { previousMonthName } from '../utils/format';

const STORAGE_KEY = 'business-cabinet-state-v2';
/** Через сколько демо-заявка из SUBMITTED уходит на рассмотрение */
const AUTO_REVIEW_MS = 6000;

const now = () => new Date().toISOString();

export const INITIAL_WIZARD: Wizard = {
  appId: null,
  goal: 'working',
  option: 0,
  amount: 2_000_000,
  term: 24,
  step: 0,
  company: EMPTY_COMPANY,
  revenue: '',
  tax: 'УСН',
  documents: [],
  savedAt: null,
};

function seedChat(): ChatMessage[] {
  return [
    {
      id: 'seed-1',
      from: 'bot',
      kind: 'greeting',
      text: 'Здравствуйте, Юлия! Помогу с документами и вашими заявками.',
      time: '10:24',
    },
    { id: 'seed-2', from: 'user', text: 'Какую выписку нужно добавить?', time: '10:25' },
    {
      id: 'seed-3',
      from: 'bot',
      kind: 'upload',
      appId: '1042',
      text: `Для заявки № 1042 нужна выписка по счёту за ${previousMonthName()}.\nОстальные данные сохранены.`,
      time: '10:25',
    },
  ];
}

export function createInitialState(): State {
  return {
    authed: false,
    user: {
      firstName: 'Юлия',
      lastName: 'Иванова',
      role: 'Руководитель компании',
      email: 'demo@example.com',
      phone: '+7 999 000-00-00',
    },
    company: DEMO_COMPANY,
    wizard: INITIAL_WIZARD,
    applications: seedApplications(),
    chat: seedChat(),
    chatMode: 'bot',
  };
}

export type Action =
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'reset' }
  | { type: 'setUserName'; firstName: string; lastName: string }
  | { type: 'wizard/patch'; patch: Partial<Wizard> }
  | { type: 'wizard/new'; goal?: GoalId; option?: number }
  | { type: 'wizard/resume'; id: string }
  | { type: 'wizard/saveDraft' }
  | { type: 'wizard/submit'; id: string }
  | { type: 'app/transition'; id: string; to: AppStatus; event: string; patch?: Partial<Application> }
  | { type: 'app/addDocuments'; id: string; documents: DocFile[] }
  | { type: 'app/accept'; id: string }
  | { type: 'app/deleteDraft'; id: string }
  | { type: 'chat/add'; message: ChatMessage }
  | { type: 'chat/mode'; mode: State['chatMode'] };

export const nextAppId = (apps: Application[]) =>
  String(Math.max(1000, ...apps.map((a) => Number(a.id)).filter(Number.isFinite)) + 1);

function applicationFromWizard(w: Wizard, id: string, status: AppStatus, existing?: Application): Application {
  const date = now();
  return {
    id,
    goal: w.goal,
    option: w.option,
    amount: w.amount,
    term: w.term,
    rate: DEMO_RATE,
    status,
    createdAt: existing?.createdAt ?? date,
    updatedAt: date,
    company: w.company,
    revenue: w.revenue,
    tax: w.tax,
    documents: w.documents,
    history: existing?.history ?? [],
    step: status === 'DRAFT' ? w.step : undefined,
  };
}

function updateApp(state: State, id: string, fn: (app: Application) => Application): State {
  return { ...state, applications: state.applications.map((a) => (a.id === id ? fn(a) : a)) };
}

const withEvent = (app: Application, text: string, patch: Partial<Application> = {}): Application => {
  const date = now();
  return { ...app, ...patch, updatedAt: date, history: [...app.history, { date, text }] };
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'login':
      return { ...state, authed: true };
    case 'logout':
      return { ...state, authed: false };
    case 'reset':
      return { ...createInitialState(), authed: true };
    case 'setUserName':
      return { ...state, user: { ...state.user, firstName: action.firstName, lastName: action.lastName } };

    case 'wizard/patch':
      return { ...state, wizard: { ...state.wizard, ...action.patch, savedAt: now() } };

    case 'wizard/new':
      return {
        ...state,
        wizard: { ...INITIAL_WIZARD, goal: action.goal ?? state.wizard.goal, option: action.option ?? 0 },
      };

    case 'wizard/resume': {
      const app = state.applications.find((a) => a.id === action.id && a.status === 'DRAFT');
      if (!app) return state;
      return {
        ...state,
        wizard: {
          appId: app.id,
          goal: app.goal,
          option: app.option,
          amount: app.amount,
          term: app.term,
          step: app.step ?? 0,
          company: app.company,
          revenue: app.revenue,
          tax: app.tax,
          documents: app.documents,
          savedAt: app.updatedAt,
        },
      };
    }

    case 'wizard/saveDraft': {
      const w = state.wizard;
      const existing = state.applications.find((a) => a.id === w.appId && a.status === 'DRAFT');
      if (existing) {
        return updateApp({ ...state, wizard: { ...w, savedAt: now() } }, existing.id, (a) =>
          applicationFromWizard(w, a.id, 'DRAFT', a),
        );
      }
      const id = nextAppId(state.applications);
      const app = withEvent(applicationFromWizard(w, id, 'DRAFT'), 'Черновик сохранён');
      return { ...state, wizard: { ...w, appId: id, savedAt: now() }, applications: [app, ...state.applications] };
    }

    case 'wizard/submit': {
      const w = state.wizard;
      const existing = state.applications.find((a) => a.id === action.id && a.status === 'DRAFT');
      const app = withEvent(applicationFromWizard(w, action.id, 'SUBMITTED', existing), 'Заявка отправлена');
      const others = state.applications.filter((a) => a.id !== action.id);
      return { ...state, wizard: INITIAL_WIZARD, applications: [app, ...others] };
    }

    case 'app/transition': {
      const app = state.applications.find((a) => a.id === action.id);
      if (!app || !canTransition(app.status, action.to)) return state;
      return updateApp(state, action.id, (a) => withEvent(a, action.event, { ...action.patch, status: action.to }));
    }

    case 'app/addDocuments':
      return updateApp(state, action.id, (a) => {
        const documents = [...a.documents, ...action.documents];
        const names = action.documents.map((d) => d.name).join(', ');
        return a.status === 'NEED_INFO'
          ? withEvent(a, `Добавлены документы: ${names}. Заявка снова на рассмотрении`, {
              documents,
              status: 'MANUAL_REVIEW',
              request: undefined,
            })
          : withEvent(a, `Добавлены документы: ${names}`, { documents });
      });

    case 'app/accept':
      return updateApp(state, action.id, (a) => {
        if (a.status === 'COUNTER_OFFER' && a.offer) {
          const terms: Terms = a.offer;
          return withEvent(a, 'Встречное предложение принято, кредит выдан', {
            ...terms,
            status: 'APPROVED',
            accepted: true,
            offer: undefined,
            documents: [...a.documents, contract(a.id)],
          });
        }
        if (a.status === 'APPROVED' && !a.accepted) {
          return withEvent(a, 'Условия приняты, кредит выдан', { accepted: true, documents: [...a.documents, contract(a.id)] });
        }
        return a;
      });

    case 'app/deleteDraft': {
      const wizard = state.wizard.appId === action.id ? INITIAL_WIZARD : state.wizard;
      return { ...state, wizard, applications: state.applications.filter((a) => !(a.id === action.id && a.status === 'DRAFT')) };
    }

    case 'chat/add':
      return { ...state, chat: [...state.chat, action.message] };
    case 'chat/mode':
      return { ...state, chatMode: action.mode };
  }
}

const contract = (id: string): DocFile => ({
  id: `contract-${id}`,
  name: `Кредитный договор № ${id}.pdf`,
  size: 412_000,
  addedAt: now(),
  demo: true,
});

function isValidState(v: unknown): v is State {
  const s = v as State;
  return (
    !!s &&
    Array.isArray(s.applications) &&
    s.applications.every((a) => a && typeof a.id === 'string' && a.status in { DRAFT: 1, SUBMITTED: 1, NEED_INFO: 1, MANUAL_REVIEW: 1, APPROVED: 1, COUNTER_OFFER: 1 }) &&
    !!s.wizard &&
    Array.isArray(s.chat)
  );
}

function loadState(): State {
  const initial = createInitialState();
  let state = initial;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (isValidState(saved)) state = { ...initial, ...saved };
  } catch {
    /* повреждённые данные — начинаем с демо */
  }
  // ?demo в адресе — сразу войти (удобно для показа и скриншотов)
  if (new URLSearchParams(window.location.search).has('demo')) state = { ...state, authed: true };
  return state;
}

const StoreContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* приватный режим — работаем без сохранения */
    }
  }, [state]);

  // Демо-backend: отправленная заявка через несколько секунд уходит специалисту.
  const submitted = state.applications.filter((a) => a.status === 'SUBMITTED').map((a) => a.id).join(',');
  useEffect(() => {
    if (!submitted) return;
    const timer = window.setTimeout(() => {
      submitted.split(',').forEach((id) =>
        dispatch({ type: 'app/transition', id, to: 'MANUAL_REVIEW', event: 'Заявка передана специалисту на рассмотрение' }),
      );
    }, AUTO_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [submitted]);

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** Заявка для главной: сначала требующие действия, затем активные, затем черновики. */
export function pickCurrentApplication(apps: Application[]) {
  return (
    apps.find(needsAction) ??
    apps.find((a) => a.status === 'SUBMITTED' || a.status === 'MANUAL_REVIEW') ??
    apps.find((a) => a.status === 'DRAFT') ??
    apps[0]
  );
}

export const findDraft = (apps: Application[]) => apps.find((a) => a.status === 'DRAFT');
