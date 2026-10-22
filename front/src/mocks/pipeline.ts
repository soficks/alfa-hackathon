import type { Application } from '../domain/types.ts';
import { isChecking } from '../domain/stateMachine.ts';
import * as db from './db.ts';
import { pipelineTick } from './operations.ts';

/**
 * Авто-проверки после отправки: SUBMITTED → AUTO_CHECKS → ЕГРЮЛ → БКИ → выписка → скоринг → решение.
 * Шаги выполняются по таймеру (nextAt хранится в заявке), поэтому переживают перезагрузку страницы:
 * заявка в SUBMITTED или AUTO_CHECKS догоняется при старте любой вкладки.
 * Если открыто несколько вкладок, заявку ведёт одна — та, что держит блокировку (owner + heartbeat).
 */
export { pipelineTick, runPipelineSync, PIPELINE_TITLES } from './operations.ts';

/** Через сколько считаем вкладку, ведущую проверки, закрытой */
const LOCK_TTL = 3000;

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
      const due = !cur.pipeline || now.getTime() >= Date.parse(cur.pipeline.nextAt);
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
