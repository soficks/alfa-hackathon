import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { isSlaOverdue } from '../../domain/alerts';
import { nearestDue, openRequests } from '../../domain/statusText';
import type { Application } from '../../domain/types';
import { useDb, useNow, useUser } from '../../store/data';
import { rub } from '../../utils/format';
import { AttentionBadges, OpenLink, ScoreChip, SlaCell, employeeNextStep, needsEmployeeAttention, searchMatch } from './common';

type Sort = 'deadline' | 'amount' | 'score';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'deadline', label: 'Сначала ближайший срок' },
  { id: 'amount', label: 'Сначала большая сумма' },
  { id: 'score', label: 'Сначала низкий балл' },
];

const deadlineOf = (a: Application) => (a.status === 'NEED_INFO' ? nearestDue(openRequests(a)) : a.slaDueAt) ?? '';

function sorter(sort: Sort) {
  return (a: Application, b: Application) => {
    if (sort === 'amount') return b.requested.amount - a.requested.amount;
    if (sort === 'score') return (a.scoring?.score ?? 0) - (b.scoring?.score ?? 0);
    return deadlineOf(a).localeCompare(deadlineOf(b));
  };
}

function Row({ app, now, primary }: { app: Application; now: Date; primary: boolean }) {
  const step = employeeNextStep(app);
  const overdue = app.status === 'NEED_INFO' ? new Date(deadlineOf(app)) < now : isSlaOverdue(app, now);
  return (
    <tr className={`${needsEmployeeAttention(app) ? 'is-attention' : ''}${overdue ? ' is-overdue' : ''}`}>
      <td>
        <strong>{app.company.name}</strong>
        <span className="sub">
          № {app.id} · {rub(app.requested.amount)}
        </span>
        <span className="flags">
          <AttentionBadges app={app} />
        </span>
      </td>
      <td>
        <strong className="step-title">{step.title}</strong>
        <span className="sub">{step.subtitle}</span>
      </td>
      <td>
        <ScoreChip app={app} />
      </td>
      <td>
        <SlaCell app={app} now={now} />
      </td>
      <td className="actions">
        <OpenLink app={app} from="my" label={primary ? 'Продолжить' : 'Открыть'} strong={primary} />
      </td>
    </tr>
  );
}

export default function MyChecksPage() {
  const user = useUser();
  const db = useDb();
  const now = useNow();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('deadline');
  const mine = db.applications.filter((a) => a.assigneeId === user.id && searchMatch(a, q));
  // строки с новыми документами, сообщениями или изменениями — наверх группы
  const action = mine
    .filter((a) => a.status === 'IN_REVIEW')
    .sort((a, b) => Number(needsEmployeeAttention(b)) - Number(needsEmployeeAttention(a)) || sorter(sort)(a, b));
  const waiting = mine.filter((a) => a.status === 'NEED_INFO').sort(sorter(sort));

  return (
    <div className="bank-page">
      <h1 className="page-title">Мои проверки</h1>
      <p className="page-subtitle">Заявки, которые вы взяли в работу</p>

      <div className="filters">
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Компания, ИНН или номер заявки" aria-label="Поиск по моим проверкам" />
        </label>
        <label className="select select--plain">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Сортировка">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="card table-card">
        <div className="table-scroll">
          <table className="data-table data-table--grouped">
            <thead>
              <tr>
                <th>Заявка</th>
                <th>Следующий шаг</th>
                <th>Балл</th>
                <th>Срок проверки</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr className="group-row">
                <th colSpan={5}>
                  Требуют моего действия <span className="tabs__count">{action.length}</span>
                </th>
              </tr>
              {action.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty-row">
                    Нет заявок, где нужно ваше действие. Возьмите новую в разделе «Заявки».
                  </td>
                </tr>
              )}
              {action.map((a) => (
                <Row key={a.id} app={a} now={now} primary />
              ))}
              <tr className="group-row">
                <th colSpan={5}>
                  Ожидаю ответа клиента <span className="tabs__count">{waiting.length}</span>
                </th>
              </tr>
              {waiting.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty-row">
                    Вы ничего не запрашивали у клиентов.
                  </td>
                </tr>
              )}
              {waiting.map((a) => (
                <Row key={a.id} app={a} now={now} primary={false} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
