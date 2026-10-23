import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/StatusBadge';
import { isFinishedBy } from '../../components/Layout';
import { PAYMENT_TYPE_LABEL } from '../../domain/finance';
import type { Application, Terms } from '../../domain/types';
import { rejectReason } from '../../config/rejectReasons';
import { productById } from '../../config/products';
import { useDb, useUser } from '../../store/data';
import { dateTimeShort, months, numericDate, plural, rub, time } from '../../utils/format';
import { searchMatch } from './common';
import { COURSE_EVENTS, DECISION_LABEL, afterDecision, decisionKind, finishedAt, type DecisionKind } from './derive';

type Period = 'current' | 'previous' | 'all';

const DECISIONS: { id: DecisionKind | 'all'; label: string }[] = [
  { id: 'all', label: 'все' },
  { id: 'approve', label: 'одобрено' },
  { id: 'counter_offer', label: 'встречное предложение' },
  { id: 'reject', label: 'отказано' },
  { id: 'withdrawn', label: 'отозвано клиентом' },
];

function periodLabel(p: Period, now: Date) {
  const name = (d: Date) => d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  if (p === 'current') return name(now);
  if (p === 'previous') return name(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  return 'всё время';
}

function inPeriod(iso: string, p: Period, now: Date) {
  if (p === 'all') return true;
  const d = new Date(iso);
  const ref = p === 'current' ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

const TONE: Record<DecisionKind, 'approved' | 'offer' | 'rejected' | 'muted'> = {
  approve: 'approved',
  counter_offer: 'offer',
  reject: 'rejected',
  withdrawn: 'muted',
};

export default function HistoryPage() {
  const user = useUser();
  const db = useDb();
  const now = new Date();
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('current');
  const [kind, setKind] = useState<DecisionKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = db.applications
    .filter((a) => isFinishedBy(a, user.id))
    .filter((a) => searchMatch(a, q))
    .filter((a) => inPeriod(finishedAt(a), period, now))
    .filter((a) => kind === 'all' || decisionKind(a) === kind)
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));

  const selected = list.find((a) => a.id === selectedId) ?? list[0];

  return (
    <div className="bank-page">
      <h1 className="page-title">История</h1>
      <p className="page-subtitle">Завершённые проверки и зафиксированные решения</p>

      <div className="filters">
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Компания, ИНН или номер заявки" aria-label="Поиск по истории" />
        </label>
        <label className="select">
          <span>Период:</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Период">
            {(['current', 'previous', 'all'] as Period[]).map((p) => (
              <option key={p} value={p}>
                {periodLabel(p, now)}
              </option>
            ))}
          </select>
        </label>
        <label className="select">
          <span>Решение:</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as DecisionKind | 'all')} aria-label="Решение">
            {DECISIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="history-grid">
        <section className="card history-list">
          <div className="history-list__head" aria-hidden="true">
            <span>Заявка</span>
            <span>Решение</span>
            <span>Завершена</span>
          </div>
          {list.length === 0 && <p className="muted empty-row">Нет проверок за выбранный период.</p>}
          {list.map((a) => {
            const k = decisionKind(a);
            return (
              <button key={a.id} type="button" className={`history-row${selected?.id === a.id ? ' is-active' : ''}`} onClick={() => setSelectedId(a.id)} aria-pressed={selected?.id === a.id}>
                <span>
                  <strong>{a.company.name}</strong>
                  <span className="sub">
                    № {a.id} · {rub((a.decision?.terms ?? a.requested).amount)}
                  </span>
                </span>
                <span>
                  {DECISION_LABEL[k]}
                  <span className="sub">{afterDecision(a)}</span>
                </span>
                <span>
                  {numericDate(finishedAt(a))}
                  <span className="sub">{time(finishedAt(a))}</span>
                </span>
              </button>
            );
          })}
          <p className="history-list__count">
            {list.length} {plural(list.length, ['завершённая проверка', 'завершённые проверки', 'завершённых проверок'])}
          </p>
        </section>

        {selected ? <Details app={selected} /> : <section className="card history-details muted">Выберите проверку слева.</section>}
      </div>
    </div>
  );
}

const termsText = (t: Terms) => `${PAYMENT_TYPE_LABEL[t.paymentType]}${t.graceMonths ? `, отсрочка ${t.graceMonths} мес.` : ''}`;

function Details({ app }: { app: Application }) {
  const k = decisionKind(app);
  const d = app.decision;
  const final = d?.terms;
  const course = app.history.filter((e) => COURSE_EVENTS.includes(e.type));
  // [подпись, запрошено, итог, изменилось ли]
  const rows: [string, string, string | undefined, boolean][] = [
    ['Сумма', rub(app.requested.amount), final && rub(final.amount), !!final && final.amount !== app.requested.amount],
    ['Срок', months(app.requested.term), final && months(final.term), !!final && final.term !== app.requested.term],
    ['Ставка', `${app.requested.rate}% (ориентир.)`, final && `${final.rate}%`, !!final && final.rate !== app.requested.rate],
    ['Тип платежа', termsText(app.requested), final && termsText(final), !!final && termsText(final) !== termsText(app.requested)],
  ];

  return (
    <section className="card history-details">
      <div className="history-details__head">
        <div>
          <h2 className="history-details__title">Проверка № {app.id}</h2>
          <p className="muted">
            {app.company.name} · {productById(app.productId).name}
          </p>
        </div>
        <Link to={`/bank/applications/${app.id}`} state={{ from: 'history' }} className="link-btn link-btn--red">
          Открыть заявку <Icon name="arrowRight" size={16} />
        </Link>
      </div>

      <dl className="kv history-details__kv">
        <dt>Решение</dt>
        <dd>
          <Badge tone={TONE[k]} label={DECISION_LABEL[k]} />
        </dd>
        <dt>Сейчас</dt>
        <dd>{afterDecision(app)}</dd>
        <dt>Сотрудник</dt>
        <dd>{d?.decidedBy ?? '—'}</dd>
        <dt>Балл скоринга</dt>
        <dd>{app.scoring ? `группа ${app.scoring.grade} · ${app.scoring.score} / 660` : '—'}</dd>
      </dl>

      <table className="compare compare--small">
        <thead>
          <tr>
            <th />
            <th>Запрошено</th>
            <th>{k === 'reject' || k === 'withdrawn' ? '' : 'Итог'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, changed]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{a}</td>
              <td className={changed ? 'is-changed' : ''}>{b ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {d && (
        <div className="history-details__block">
          <h3>Обоснование</h3>
          <p>{d.justification}</p>
        </div>
      )}
      {k === 'reject' && d && (
        <div className="history-details__block">
          <h3>Причина отказа: {rejectReason(d.reasonCode).title.toLowerCase()}</h3>
          <p className="muted">Сообщение клиенту: «{d.clientMessage}»</p>
        </div>
      )}
      {app.declineReason && (
        <div className="history-details__block">
          <h3>Почему клиент отказался</h3>
          <p>{app.declineReason}</p>
        </div>
      )}

      <div className="history-details__block">
        <h3>Ход проверки</h3>
        <ol className="course">
          {course.map((e) => (
            <li key={e.id}>
              <span className="course__time">{dateTimeShort(e.at)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="micro">
        <Icon name="lock" size={14} /> Запись доступна только для просмотра
      </p>
    </section>
  );
}
