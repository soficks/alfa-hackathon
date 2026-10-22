import type { Application } from './types.ts';
import { CLIENT_STATUS_LABEL, clientNeedsAction, clientNextStep } from './statusText.ts';
import { isFinal } from './stateMachine.ts';

export interface Alert {
  id: string;
  appId: string;
  title: string;
  text: string;
  /** куда вести: маршрут с якорем блока */
  to: string;
  /** новое (точка на колокольчике) — а не просто напоминание */
  fresh: boolean;
}

const lastUnread = (app: Application, by: 'client' | 'employee') =>
  [...app.messages].reverse().find((m) => m.author === by && (by === 'employee' ? !m.readByClient : !m.readByEmployee));

const ACTION_ANCHOR: Partial<Record<Application['status'], string>> = {
  NEED_INFO: '#requests',
  APPROVED: '#decision',
  COUNTER_OFFER: '#decision',
  SIGNING: '#decision',
};

/** Колокольчик клиента: нужно действие, новые сообщения специалиста, новые запросы документов. */
export function clientAlerts(apps: Application[]): Alert[] {
  const list: Alert[] = [];
  for (const app of apps) {
    if (clientNeedsAction(app)) {
      const unseenRequest = app.docRequests.some((r) => !r.fulfilledByDocId && !r.seenByClient);
      list.push({
        id: `${app.id}-action`,
        appId: app.id,
        title: `№ ${app.id}: ${CLIENT_STATUS_LABEL[app.status]}`,
        text: clientNextStep(app),
        to: `/applications/${app.id}${ACTION_ANCHOR[app.status] ?? ''}`,
        fresh: unseenRequest || app.status !== 'NEED_INFO',
      });
    }
    const msg = lastUnread(app, 'employee');
    if (msg) {
      list.push({
        id: `${app.id}-msg`,
        appId: app.id,
        title: `Сообщение по заявке № ${app.id}`,
        text: `${msg.authorName}: ${msg.text}`,
        to: `/applications/${app.id}#messages`,
        fresh: true,
      });
    }
  }
  return list;
}

export const unreadForClient = (app: Application) => app.messages.filter((m) => m.author === 'employee' && !m.readByClient).length;
export const unreadForEmployee = (app: Application) => app.messages.filter((m) => m.author === 'client' && !m.readByEmployee).length;

export const isSlaOverdue = (app: Application, now: Date) =>
  (app.status === 'IN_QUEUE' || app.status === 'IN_REVIEW') && !!app.slaDueAt && new Date(app.slaDueAt) < now;

/** Колокольчик сотрудника: запрошенное загружено, новое сообщение, данные изменены, просрочен срок проверки. */
export function employeeAlerts(apps: Application[], employeeId: string, now: Date): Alert[] {
  const list: Alert[] = [];
  for (const app of apps) {
    const mine = app.assigneeId === employeeId;
    if (mine && app.newDocsForEmployee) {
      list.push({ id: `${app.id}-docs`, appId: app.id, title: `№ ${app.id}: клиент загрузил документы`, text: app.company.name, to: `/bank/applications/${app.id}?tab=docs`, fresh: true });
    }
    const msg = mine ? lastUnread(app, 'client') : undefined;
    if (msg) {
      list.push({ id: `${app.id}-msg`, appId: app.id, title: `№ ${app.id}: новое сообщение клиента`, text: msg.text, to: `/bank/applications/${app.id}?tab=messages`, fresh: true });
    }
    if (mine && app.changedSinceReview) {
      list.push({ id: `${app.id}-changed`, appId: app.id, title: `№ ${app.id}: клиент изменил данные`, text: app.company.name, to: `/bank/applications/${app.id}`, fresh: true });
    }
    if ((mine || app.status === 'IN_QUEUE') && !isFinal(app.status) && isSlaOverdue(app, now)) {
      list.push({ id: `${app.id}-sla`, appId: app.id, title: `№ ${app.id}: просрочен срок проверки`, text: app.company.name, to: `/bank/applications/${app.id}`, fresh: true });
    }
  }
  return list;
}
