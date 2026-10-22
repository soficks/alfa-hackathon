import { Link } from 'react-router-dom';
import { DOC_TYPES } from '../../config/docTypes';
import { missingDocTypes } from './derive';
import { unreadForEmployee, isSlaOverdue } from '../../domain/alerts';
import { nearestDue, openRequests, zoneLabel } from '../../domain/statusText';
import type { Application, ScoreZone } from '../../domain/types';
import { dateTime } from '../../utils/format';

export function ScoreChip({ app }: { app: Application }) {
  if (!app.scoring) return <span className="muted">—</span>;
  const { score, zone } = app.scoring;
  return (
    <span className={`score-chip score-chip--${zone}`} title={zoneLabel[zone]}>
      {score}
    </span>
  );
}

export const ZONE_OPTIONS: { id: ScoreZone | 'all'; label: string }[] = [
  { id: 'all', label: 'Все зоны' },
  { id: 'auto', label: '700+ · авто-одобрение' },
  { id: 'manual', label: '400–699 · ручная проверка' },
  { id: 'high_risk', label: '0–399 · высокий риск' },
];

export function SlaCell({ app, now }: { app: Application; now: Date }) {
  if (app.status === 'NEED_INFO') {
    const due = nearestDue(openRequests(app));
    if (!due) return <span className="muted">—</span>;
    const overdue = new Date(due) < now;
    return <span className={overdue ? 'sla sla--overdue' : 'sla'}>{overdue ? `Просрочено: ${dateTime(due)}` : `Ответ до ${dateTime(due)}`}</span>;
  }
  if (!app.slaDueAt) return <span className="muted">—</span>;
  const overdue = isSlaOverdue(app, now);
  return <span className={overdue ? 'sla sla--overdue' : 'sla'}>{overdue ? `Просрочено: ${dateTime(app.slaDueAt)}` : dateTime(app.slaDueAt)}</span>;
}

export interface NextStep {
  title: string;
  subtitle: string;
}

/** «Следующий шаг» сотрудника — вычисляется из состояния заявки. */
export function employeeNextStep(app: Application): NextStep {
  if (app.status === 'IN_QUEUE') return { title: 'Взять в работу', subtitle: app.recommendation?.text ?? 'Ожидает специалиста' };
  if (app.status === 'NEED_INFO') {
    const open = openRequests(app);
    return {
      title: open.map((r) => DOC_TYPES[r.docType].title).join(', '),
      subtitle: open.length ? `Запрошено ${dateTime(open[0].createdAt)}` : 'Ждём клиента',
    };
  }
  if (app.status !== 'IN_REVIEW') return { title: '—', subtitle: '' };

  if (app.changedSinceReview) {
    const last = [...app.history].reverse().find((e) => e.type === 'client_changed');
    return { title: 'Ознакомиться с изменениями клиента', subtitle: last?.text ?? 'Клиент изменил данные заявки' };
  }
  if (app.newDocsForEmployee) {
    const answered = app.docRequests.filter((r) => r.fulfilledByDocId).slice(-3);
    const titles = answered.length ? answered.map((r) => DOC_TYPES[r.docType].title).join(', ') : 'документы клиента';
    return { title: `Проверить новые документы: ${titles}`, subtitle: 'Клиент ответил на запрос' };
  }
  const unread = unreadForEmployee(app);
  if (unread) {
    const msg = [...app.messages].reverse().find((m) => m.author === 'client');
    return { title: 'Ответить клиенту', subtitle: msg?.text ?? '' };
  }
  const dynamics = app.scoring?.factors.find((f) => f.id === 'turnover_dynamics');
  if (dynamics && dynamics.points < 0) {
    return { title: 'Проверить источники погашения', subtitle: dynamics.explanation };
  }
  const missing = missingDocTypes(app);
  if (missing.length) {
    return { title: 'Запросить недостающие документы', subtitle: missing.map((t) => DOC_TYPES[t].title).join(', ') };
  }
  const problem = app.checks.find((c) => c.status !== 'ok');
  if (problem) return { title: `Проверить: ${problem.title.toLowerCase()}`, subtitle: problem.details.find((d) => /нет|не |просроч|меньше/i.test(d)) ?? problem.details[0] };
  return { title: 'Принять решение', subtitle: 'Проверки пройдены, запросов к клиенту нет' };
}

export function AttentionBadges({ app }: { app: Application }) {
  return (
    <>
      {app.newDocsForEmployee && <span className="flag flag--docs">Новые документы</span>}
      {unreadForEmployee(app) > 0 && <span className="flag flag--msg">Новое сообщение</span>}
      {app.changedSinceReview && <span className="flag flag--changed">Данные изменены</span>}
    </>
  );
}

export const needsEmployeeAttention = (app: Application) => !!app.newDocsForEmployee || unreadForEmployee(app) > 0 || !!app.changedSinceReview;

export function OpenLink({ app, from, label = 'Открыть', strong = false }: { app: Application; from: 'queue' | 'my' | 'history'; label?: string; strong?: boolean }) {
  return (
    <Link to={`/bank/applications/${app.id}`} state={{ from }} className={`row-link${strong ? ' row-link--strong' : ''}`}>
      {label} →
    </Link>
  );
}

export const searchMatch = (app: Application, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return app.company.name.toLowerCase().includes(s) || app.company.inn.includes(s) || app.id.includes(s);
};

