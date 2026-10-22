import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../api';
import type { Application, DbState, Role, User } from '../domain/types';

/* ---------- Данные (общие для всех вкладок) ---------- */

export function useDb(): DbState {
  return useSyncExternalStore(api.store.subscribe, api.store.getSnapshot);
}

export function useApplication(id: string | undefined): Application | undefined {
  const db = useDb();
  return db.applications.find((a) => a.id === id);
}

export function useUserName() {
  const db = useDb();
  return useCallback(
    (userId?: string) => {
      const u = db.users.find((x) => x.id === userId);
      return u ? `${u.firstName} ${u.lastName}` : 'другой сотрудник';
    },
    [db.users],
  );
}

/* ---------- Сессия вкладки ---------- */

const SESSION_KEY = 'business-cabinet-session';

interface SessionValue {
  user: User | null;
  /** userId — войти конкретным демо-пользователем этой роли */
  login: (role: Role, userId?: string) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function readSession(): string | null {
  try {
    return (JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { userId?: string } | null)?.userId ?? null;
  } catch {
    return null;
  }
}

function writeSession(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* без сохранения сессии */
  }
}

/** Демо-пользователь роли: первый клиент или Анна Смирнова для сотрудника. */
const demoUserId = (db: DbState, role: Role) => db.users.find((u) => u.role === role)?.id ?? null;

function initialUserId(): string | null {
  const demo = new URLSearchParams(window.location.search).get('demo');
  if (demo !== null) {
    const id = demoUserId(api.store.getSnapshot(), demo === 'bank' ? 'employee' : 'client');
    writeSession(id);
    return id;
  }
  return readSession();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [userId, setUserId] = useState<string | null>(initialUserId);
  const user = db.users.find((u) => u.id === userId) ?? null;

  const login = useCallback(
    (role: Role, userId?: string) => {
      const id = userId ?? demoUserId(api.store.getSnapshot(), role);
      writeSession(id);
      setUserId(id);
    },
    [],
  );

  const logout = useCallback(() => {
    writeSession(null);
    setUserId(null);
  }, []);

  // Фоновые задачи «сервера» (авто-проверки) работают, пока открыта хотя бы одна вкладка
  useEffect(() => api.store.startBackgroundJobs(), []);

  return <SessionContext.Provider value={{ user, login, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Текущий пользователь (внутри защищённых маршрутов он всегда есть). */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('Нет пользователя в сессии');
  return user;
}

/* ---------- Асинхронные действия ---------- */

/** Обёртка над вызовом api: флаг загрузки и текст ошибки. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Что-то пошло не так');
      return undefined;
    } finally {
      if (alive.current) setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}

/** Тик раз в минуту — для «Сегодня, 18:00», просрочек и сроков. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
