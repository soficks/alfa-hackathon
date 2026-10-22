import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ClientStatusBadge } from '../../components/StatusBadge';
import { api } from '../../api';
import { goalById } from '../../config/products';
import { isFinal } from '../../domain/stateMachine';
import { clientNeedsAction, clientNextStep, clientStageLabel } from '../../domain/statusText';
import type { Application } from '../../domain/types';
import { useDb, useUser } from '../../store/data';
import { dateTime, months, rub } from '../../utils/format';
import { CLIENT_ACTION_LABEL, UnreadBadge, isActive, termsOf, useOpenApplication } from './common';

const TABS: { id: string; label: string; match: (a: Application) => boolean }[] = [
  { id: 'active', label: 'Активные', match: isActive },
  { id: 'action', label: 'Нужно действие', match: clientNeedsAction },
  { id: 'drafts', label: 'Черновики', match: (a) => a.status === 'DRAFT' },
  { id: 'done', label: 'Завершённые', match: (a) => isFinal(a.status) },
];

export default function ApplicationsPage() {
  const user = useUser();
  const db = useDb();
  const navigate = useNavigate();
  const open = useOpenApplication();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];
  const mine = db.applications.filter((a) => a.ownerUserId === user.id);
  const list = mine
    .filter(tab.match)
    .sort((a, b) => Number(clientNeedsAction(b)) - Number(clientNeedsAction(a)) || b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="apps">
      <div className="page-head">
        <div>
          <h1 className="page-title">Мои заявки</h1>
          <p className="page-subtitle">Статусы, условия и следующие шаги — в одном месте</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => {
            await api.applications.newWizard(user.id);
            navigate('/financing');
          }}
        >
          Новая заявка <Icon name="plus" size={18} />
        </button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            className={`tabs__tab${t.id === tab.id ? ' is-active' : ''}`}
            onClick={() => setParams(t.id === 'active' ? {} : { tab: t.id })}
          >
            {t.label}
            <span className="tabs__count">{mine.filter(t.match).length}</span>
          </button>
        ))}
      </div>

      <div className="apps__list">
        {list.length === 0 && (
          <div className="card empty">
            <Icon name="document" size={32} />
            <h2 className="card-title">Здесь пока нет заявок</h2>
            <p className="muted">{tab.id === 'action' ? 'Сейчас от вас ничего не нужно.' : 'Заявки появятся здесь, когда вы их создадите.'}</p>
          </div>
        )}
        {list.map((a) => {
          const t = termsOf(a);
          const action = CLIENT_ACTION_LABEL[a.status];
          return (
            <article key={a.id} className={`app-row card${clientNeedsAction(a) ? ' app-row--attention' : ''}`}>
              <div className="app-row__head">
                <h2 className="app-row__title">
                  <button type="button" className="app-row__link" onClick={() => open(a)}>
                    {goalById(a.goalId).title}
                  </button>
                </h2>
                <ClientStatusBadge app={a} />
                <UnreadBadge app={a} />
                <span className="app-row__meta">
                  № {a.id} · обновлена {dateTime(a.updatedAt)}
                </span>
              </div>
              <div className="app-row__body">
                <div className="metric">
                  <span className="metric__label">Сумма</span>
                  <span className="metric__value">{rub(t.amount)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Срок</span>
                  <span className="metric__value">{months(t.term)}</span>
                </div>
                <div className="app-row__next">
                  <span className="app-row__stage">{clientStageLabel(a.status)}</span>
                  <p>{clientNextStep(a)}</p>
                </div>
                <button type="button" className={`btn ${action ? 'btn--primary' : 'btn--outline'} btn--sm app-row__btn`} onClick={() => open(a)}>
                  {action ?? 'Подробнее'} <Icon name="chevronRight" size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="micro">Все заявки в этом кабинете демонстрационные.</p>
    </div>
  );
}
