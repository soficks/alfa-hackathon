import type { Application } from '../domain/types.ts';
import { isChecking } from '../domain/stateMachine.ts';
import * as db from './db.ts';
import { SYSTEM, applyBackendDecision, applyBackendScoring, pipelineTick, withEvent } from './operations.ts';
import { handledByBackend, requestDecision, type BackendDecision } from './backend.ts';

/**
 * Авто-проверки после отправки: SUBMITTED → AUTO_CHECKS → ЕГРЮЛ → БКИ → выписка → скоринг → решение.
 * Шаги выполняются по таймеру (nextAt хранится в заявке), поэтому переживают перезагрузку страницы:
 * заявка в SUBMITTED или AUTO_CHECKS догоняется при старте любой вкладки.
 * Если открыто несколько вкладок, заявку ведёт одна — та, что держит блокировку (owner + heartbeat).
 * Шаги «скоринг» и «решение» при доступном бэкенде выполняет его конвейер (backend/main.py).
 */
export { pipelineTick, runPipelineSync, PIPELINE_TITLES } from './operations.ts';

/** Через сколько считаем вкладку, ведущую проверки, закрытой */
const LOCK_TTL = 3000;

/** Заявки, по которым запрос в бэкенд уже в пути */
const inFlight = new Set<string>();
/** Ответ бэкенда с шага «скоринг» — по нему же принимается «решение» */
const responses = new Map<string, BackendDecision>();

type BackendStep = 'scoring' | 'decision';

function backendStep(a: Application): BackendStep | null {
  if (a.status !== 'AUTO_CHECKS') return null;
  const id = a.pipeline?.steps.find((s) => s.status === 'pending')?.id;
  return id === 'scoring' || id === 'decision' ? id : null;
}

const applyStep = (step: BackendStep, a: Application, res: BackendDecision, at: Date) =>
  step === 'scoring' ? applyBackendScoring(a, res, at) : applyBackendDecision(a, res, at);

/** «Решение» по ответу, полученному на шаге «скоринг», — синхронно, внутри тика. */
function applyCached(app: Application, step: BackendStep, at: Date): Application | null {
  const res = step === 'decision' ? responses.get(app.id) : undefined;
  if (!res) return null;
  responses.delete(app.id);
  return applyBackendDecision(app, res, at);
}

function runOnBackend(app: Application, step: BackendStep) {
  if (inFlight.has(app.id)) return;
  inFlight.add(app.id);
  const finish = (fn: (a: Application, at: Date) => Application) =>
    db.update((state) => {
      const current = state.applications.find((a) => a.id === app.id);
      if (!current || backendStep(current) !== step) return state; // заявку успели изменить
      const next = fn(current, new Date());
      return { ...state, applications: state.applications.map((a) => (a.id === app.id ? next : a)) };
    });
  requestDecision(app)
    .then((res) => {
      if (step === 'scoring') responses.set(app.id, res);
      finish((a, at) => applyStep(step, a, res, at));
    })
    .catch((e: unknown) =>
      finish((a, at) =>
        pipelineTick(
          withEvent(a, at, SYSTEM, 'backend_error', `Бэкенд недоступен (${e instanceof Error ? e.message : e}) — ${step === 'scoring' ? 'скоринг' : 'решение'} по локальной модели`, {
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
      const step = due && handledByBackend(cur) ? backendStep(cur) : null;
      if (step) {
        const cached = applyCached(cur, step, now);
        if (cached) cur = cached;
        else {
          runOnBackend(cur, step); // ответ применится асинхронно, вкладка держит блокировку до него
          due = false;
        }
      } else if (due) cur = pipelineTick(cur, now);
      if (due || !mine || now.getTime() - heartbeat > 1000) {
        changed = true;
        return cur;
      }
      return a;
    });
    return changed ? { ...state, applications } : state;
  });
}
