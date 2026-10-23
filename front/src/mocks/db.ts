import type { DbState } from '../domain/types.ts';
import { createSeed } from './seed.ts';

/**
 * Общее хранилище клиента и сотрудника — localStorage.
 * Каждая запись — «прочитать свежее → изменить → записать», поэтому вкладки не затирают друг друга.
 * Изменения из другой вкладки приходят через событие storage.
 */
/** v4: скоринговая карта 300–660, платёжеспособность и маршрут по ТЗ */
export const STORAGE_KEY = 'business-cabinet-state-v4';
const LEGACY_KEYS = ['business-cabinet-state-v3', 'business-cabinet-state-v2', 'business-cabinet-state-v1'];

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: DbState | null = null;

function isValid(v: unknown): v is DbState {
  const s = v as DbState;
  return (
    !!s &&
    s.schema === 3 &&
    s.applications.every((a) => !a.scoring || 'grade' in a.scoring) &&
    Array.isArray(s.users) &&
    Array.isArray(s.applications) &&
    Array.isArray(s.accounts) &&
    typeof s.wizards === 'object' &&
    typeof s.botChats === 'object' &&
    s.applications.every((a) => typeof a.id === 'string' && typeof a.status === 'string' && Array.isArray(a.history))
  );
}

function readRaw(): DbState | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(state: DbState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* приватный режим — работаем в памяти */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

/** Старый или повреждённый формат заменяем сидом. */
function load(): DbState {
  try {
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* нет доступа к хранилищу */
  }
  const saved = readRaw();
  if (saved) return saved;
  const seeded = createSeed(new Date());
  persist(seeded);
  return seeded;
}

export function getSnapshot(): DbState {
  if (!cache) cache = load();
  return cache;
}

/** Атомарное изменение: свежее состояние из хранилища → fn → запись → уведомление. */
export function update(fn: (state: DbState) => DbState): DbState {
  const fresh = readRaw() ?? getSnapshot();
  const next = fn(fresh);
  if (next === fresh) return fresh;
  persist(next);
  cache = next;
  emit();
  return next;
}

export function reset(): DbState {
  const seeded = createSeed(new Date());
  persist(seeded);
  cache = seeded;
  emit();
  return seeded;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    cache = null;
    emit();
  });
}
