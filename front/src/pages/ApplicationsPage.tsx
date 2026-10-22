import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import { STAGES, actionLabel, goalById, needsAction, nextStepText, stageStates } from '../store/data';
import { useStore } from '../store/store';
import type { Application } from '../store/types';
import { dayMonth, months, rub } from '../utils/format';

const TABS: { id: string; label: string; match: (a: Application) => boolean }[] = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'work', label: 'На рассмотрении', match: (a) => a.status === 'SUBMITTED' || a.status === 'MANUAL_REVIEW' },
  { id: 'docs', label: 'Нужны документы', match: (a) => a.status === 'NEED_INFO' },
  { id: 'offers', label: 'Предложения', match: (a) => a.status === 'COUNTER_OFFER' || (a.status === 'APPROVED' && !a.accepted) },
  { id: 'drafts', label: 'Черновики', match: (a) => a.status === 'DRAFT' },
  { id: 'done', label: 'Завершённые', match: (a) => a.status === 'APPROVED' && !!a.accepted },
];

function stageText(app: Application) {
  const states = stageStates(app);
  const i = states.findIndex((s) => s !== 'done');
  return i === -1 ? 'Все этапы пройдены' : `Этап ${i + 1} из ${STAGES.length} · ${STAGES[i]}`;
}

function dateText(app: Application) {
  if (app.status === 'DRAFT') return `Сохранена ${dayMonth(app.updatedAt)}`;
  return `Отправлена ${dayMonth(app.createdAt)} · обновлена ${dayMonth(app.updatedAt)}`;
}

export default function ApplicationsPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];

  // Требующие действия — наверху, внутри групп — свежие первыми
  const list = state.applications
    .filter(tab.match)
    .sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)) || b.updatedAt.localeCompare(a.updatedAt));

  const open = (app: Application) => {
    if (app.status === 'DRAFT') {
      dispatch({ type: 'wizard/resume', id: app.id });
      navigate('/financing/calculator');
    } else navigate(`/applications/${app.id}`);
  };

  return (
    <div className="apps">
      <div className="page-head">
        <div>
          <h1 className="page-title">Мои заявки</h1>
          <p className="page-subtitle">Статусы, условия и следующие шаги — в одном месте</p>
        </div>
        <Link to="/financing" className="btn btn--primary" onClick={() => dispatch({ type: 'wizard/new' })}>
          Новая заявка <Icon name="plus" size={18} />
        </Link>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            className={`tabs__tab${t.id === tab.id ? ' is-active' : ''}`}
            onClick={() => setParams(t.id === 'all' ? {} : { tab: t.id })}
          >
            {t.label}
            <span className="tabs__count">{state.applications.filter(t.match).length}</span>
          </button>
        ))}
      </div>

      <div className="apps__list">
        {list.length === 0 && (
          <div className="card empty">
            <Icon name="document" size={32} />
            <h2 className="card-title">Здесь пока нет заявок</h2>
            <p className="muted">Заявки с выбранным статусом появятся здесь.</p>
          </div>
        )}
        {list.map((app) => {
          const primary = needsAction(app) || app.status === 'DRAFT';
          return (
            <article key={app.id} className={`app-row card${needsAction(app) ? ' app-row--attention' : ''}`}>
              <div className="app-row__head">
                <h2 className="app-row__title">
                  <Link to={app.status === 'DRAFT' ? '/financing/calculator' : `/applications/${app.id}`} onClick={(e) => {
                    if (app.status === 'DRAFT') {
                      e.preventDefault();
                      open(app);
                    }
                  }}>
                    {goalById(app.goal).title}
                  </Link>
                </h2>
                <StatusBadge app={app} />
                <span className="app-row__meta">
                  № {app.id} · {dateText(app)}
                </span>
              </div>
              <div className="app-row__body">
                <div className="metric">
                  <span className="metric__label">Сумма</span>
                  <span className="metric__value">{rub(app.amount)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Срок</span>
                  <span className="metric__value">{months(app.term)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Документы</span>
                  <span className="metric__value metric__value--sm">{app.documents.length || '—'}</span>
                </div>
                <div className="app-row__next">
                  <span className="app-row__stage">{stageText(app)}</span>
                  <p>{nextStepText(app)}</p>
                </div>
                <button type="button" className={`btn ${primary ? 'btn--primary' : 'btn--outline'} btn--sm app-row__btn`} onClick={() => open(app)}>
                  {actionLabel(app)} <Icon name="chevronRight" size={16} />
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
