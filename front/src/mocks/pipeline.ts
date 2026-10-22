import type { Application } from '../domain/types.ts';
import { isChecking } from '../domain/stateMachine.ts';
import * as db from './db.ts';
import { SYSTEM, applyBackendDecision, pipelineTick, withEvent } from './operations.ts';
import { isBackendOnline, requestDecision } from './backend.ts';

/**
 * Авто-проверки после отправки: SUBMITTED → AUTO_CHECKS → ЕГРЮЛ → БКИ → выписка → скоринг → решение.
 * Шаги выполняются по таймеру (nextAt хранится в заявке), поэтому переживают перезагрузку страницы:
 * заявка в SUBMITTED или AUTO_CHECKS догоняется при старте любой вкладки.
 * Если открыто несколько вкладок, заявку ведёт одна — та, что держит блокировку (owner + heartbeat).
 * Шаг «решение» при доступном бэкенде принимает его конвейер (backend/main.py).
 */
export { pipelineTick, runPipelineSync, PIPELINE_TITLES } from './operations.ts';

/** Через сколько считаем вкладку, ведущую проверки, закрытой */
const LOCK_TTL = 3000;

/** Заявки, по которым запрос в бэкенд уже в пути */
const inFlight = new Set<string>();

const awaitsDecision = (a: Application) => a.status === 'AUTO_CHECKS' && a.pipeline?.steps.find((s) => s.status === 'pending')?.id === 'decision';

function decideOnBackend(app: Application) {
  if (inFlight.has(app.id)) return;
  inFlight.add(app.id);
  const finish = (fn: (a: Application, at: Date) => Application) =>
    db.update((state) => {
      const current = state.applications.find((a) => a.id === app.id);
      if (!current || !awaitsDecision(current)) return state; // заявку успели изменить
      const next = fn(current, new Date());
      return { ...state, applications: state.applications.map((a) => (a.id === app.id ? next : a)) };
    });
  requestDecision(app)
    .then((res) => finish((a, at) => applyBackendDecision(a, res, at)))
    .catch((e: unknown) =>
      finish((a, at) =>
        pipelineTick(
          withEvent(a, at, SYSTEM, 'backend_error', `Бэкенд недоступен (${e instanceof Error ? e.message : e}) — решение по локальной модели`, {
            visibleToClient: false,
          }),
          at,
        ),
      ),
    )
    .finally(() => inFlight.delete(app.id));
}

export function tickPipelines(tabId: string) {
  if (!db.getSnapshot().applications.some((a) => isChecking(a.status))) return;
  db.update((state) => {
    const now = new Date();
    let changed = false;
    const applications = state.applications.map((a): Application => {
      if (!isChecking(a.status)) return a;
      const p = a.pipeline;
      const heartbeat = p?.heartbeat ? Date.parse(p.heartbeat) : 0;
      const mine = p?.owner === tabId;
      if (p?.owner && !mine && now.getTime() - heartbeat < LOCK_TTL) return a; // ведёт другая вкладка
      let cur: Application = p ? { ...a, pipeline: { ...p, owner: tabId, heartbeat: now.toISOString() } } : a;
      let due = !cur.pipeline || now.getTime() >= Date.parse(cur.pipeline.nextAt);
      if (due && isBackendOnline() && awaitsDecision(cur)) {
        decideOnBackend(cur); // ответ применится асинхронно, вкладка держит блокировку до него
        due = false;
      }
      if (due) cur = pipelineTick(cur, now);
      if (due || !mine || now.getTime() - heartbeat > 1000) {
        changed = true;
        return cur;
      }
      return a;
    });
    return changed ? { ...state, applications } : state;
  });
}
