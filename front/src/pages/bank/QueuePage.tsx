import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmployeeStatusBadge } from '../../components/StatusBadge';
import { api } from '../../api';
import { PRODUCTS, goalById, productById } from '../../config/products';
import { isSlaOverdue } from '../../domain/alerts';
import type { Application, ScoreZone } from '../../domain/types';
import { useAction, useDb, useNow, useUser, useUserName } from '../../store/data';
import { dateTime, months, rub } from '../../utils/format';
import { OpenLink, ScoreChip, SlaCell, ZONE_OPTIONS, searchMatch } from './common';

export default function QueuePage() {
  const user = useUser();
  const db = useDb();
  const now = useNow();
  const navigate = useNavigate();
  const nameOf = useUserName();
  const { run, pending, error } = useAction();
  const [q, setQ] = useState('');
  const [product, setProduct] = useState('all');
  const [zone, setZone] = useState<ScoreZone | 'all'>('all');
  const [taking, setTaking] = useState<string | null>(null);

  const queue = db.applications
    .filter((a) => a.status === 'IN_QUEUE')
    .filter((a) => searchMatch(a, q))
    .filter((a) => product === 'all' || a.productId === product)
    .filter((a) => zone === 'all' || a.scoring?.zone === zone)
    .sort((a, b) => (a.slaDueAt ?? '').localeCompare(b.slaDueAt ?? ''));

  const colleagues = db.applications.filter((a) => a.assigneeId && a.assigneeId !== user.id && (a.status === 'IN_REVIEW' || a.status === 'NEED_INFO'));

  const take = async (a: Application) => {
    setTaking(a.id);
    const ok = await run(() => api.applications.takeToWork(a.id, user.id));
    setTaking(null);
    if (ok) navigate(`/bank/applications/${a.id}`, { state: { from: 'my' } });
  };

  return (
    <div className="bank-page">
      <h1 className="page-title">Заявки</h1>
      <p className="page-subtitle">Новые заявки после авто-проверок — ждут специалиста</p>

      <div className="filters">
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Компания, ИНН или номер заявки" aria-label="Поиск по заявкам" />
        </label>
        <label className="select">
          <span>Продукт:</span>
          <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Фильтр по продукту">
            <option value="all">все</option>
            {PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="select">
          <span>Скоринг:</span>
          <select value={zone} onChange={(e) => setZone(e.target.value as ScoreZone | 'all')} aria-label="Фильтр по зоне скоринга">
            {ZONE_OPTIONS.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="card table-card">
        {queue.length === 0 ? (
          <div className="empty">
            <Icon name="checkCircle" size={32} />
            <h2 className="card-title">Очередь пуста</h2>
            <p className="muted">{q || product !== 'all' || zone !== 'all' ? 'По выбранным фильтрам заявок нет.' : 'Все новые заявки разобраны.'}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Компания</th>
                  <th>Продукт</th>
                  <th className="num">Сумма и срок</th>
                  <th>Балл</th>
                  <th>Рекомендация системы</th>
                  <th>Поступила</th>
                  <th>Срок проверки ↑</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((a) => (
                  <tr key={a.id} className={isSlaOverdue(a, now) ? 'is-overdue' : ''}>
                    <td>
                      <strong>{a.company.name}</strong>
                      <span className="sub">
                        № {a.id} · ИНН {a.company.inn}
                      </span>
                    </td>
                    <td>
                      {productById(a.productId).name}
                      <span className="sub">{goalById(a.goalId).title}</span>
                    </td>
                    <td className="num">
                      {rub(a.requested.amount)}
                      <span className="sub">{months(a.requested.term)}</span>
                    </td>
                    <td>
                      <ScoreChip app={a} />
                    </td>
                    <td className="rec">{a.recommendation?.text ?? '—'}</td>
                    <td>{a.submittedAt ? dateTime(a.submittedAt) : '—'}</td>
                    <td>
                      <SlaCell app={a} now={now} />
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => take(a)} disabled={pending}>
                        {taking === a.id ? 'Берём…' : 'Взять в работу'}
                      </button>
                      <OpenLink app={a} from="queue" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>

      {colleagues.length > 0 && (
        <section className="card table-card">
          <h2 className="card-title">В работе у коллег</h2>
          <p className="muted form-note">Только просмотр: решения принимает назначенный специалист.</p>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                {colleagues.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.company.name}</strong>
                      <span className="sub">№ {a.id}</span>
                    </td>
                    <td className="num">{rub(a.requested.amount)}</td>
                    <td>
                      <EmployeeStatusBadge app={a} />
                    </td>
                    <td className="muted">{nameOf(a.assigneeId)}</td>
                    <td className="actions">
                      <OpenLink app={a} from="queue" label="Посмотреть" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
