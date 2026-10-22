import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import StageProgress from '../../components/StageProgress';
import { ClientStatusBadge } from '../../components/StatusBadge';
import { api } from '../../api';
import { goalById } from '../../config/products';
import { paymentSummary } from '../../domain/finance';
import { unreadForClient } from '../../domain/alerts';
import { isChecking, isFinal } from '../../domain/stateMachine';
import { clientNeedsAction, clientNextStep } from '../../domain/statusText';
import type { Application } from '../../domain/types';
import { useUser } from '../../store/data';
import { months, rub } from '../../utils/format';

/** Итоговые условия: после решения — из решения */
export const termsOf = (app: Application) => app.decision?.terms ?? app.requested;

/** Приоритет для главной: нужно действие → в работе → черновик. */
export function pickCurrent(apps: Application[]) {
  return (
    apps.find(clientNeedsAction) ??
    apps.find((a) => isChecking(a.status) || a.status === 'IN_QUEUE' || a.status === 'IN_REVIEW') ??
    apps.find((a) => a.status === 'DRAFT')
  );
}

export const CLIENT_ACTION_LABEL: Partial<Record<Application['status'], string>> = {
  DRAFT: 'Продолжить',
  NEED_INFO: 'Загрузить документы',
  APPROVED: 'Принять условия',
  COUNTER_OFFER: 'Посмотреть предложение',
  SIGNING: 'Подписать документы',
};

/** Открыть заявку: черновик — в мастер, остальное — в карточку. */
export function useOpenApplication() {
  const navigate = useNavigate();
  const user = useUser();
  return async (app: Application) => {
    if (app.status === 'DRAFT') {
      await api.applications.resumeDraft(user.id, app.id);
      navigate('/financing/calculator');
    } else {
      navigate(`/applications/${app.id}`);
    }
  };
}

export function UnreadBadge({ app }: { app: Application }) {
  const n = unreadForClient(app);
  if (!n) return null;
  return (
    <span className="unread" aria-label={`Непрочитанных сообщений: ${n}`}>
      <Icon name="chat" size={14} /> {n}
    </span>
  );
}

export function CurrentApplicationCard({ app, title = 'Текущая заявка' }: { app: Application; title?: string }) {
  const open = useOpenApplication();
  const terms = termsOf(app);
  const main = paymentSummary(terms)[0];
  const action = CLIENT_ACTION_LABEL[app.status];
  return (
    <section className={`card current${clientNeedsAction(app) ? ' current--attention' : ''}`}>
      <div className="current__head">
        <div>
          <h2 className="card-title">
            {title} <UnreadBadge app={app} />
          </h2>
          <p className="current__meta">
            № {app.id}
            <span className="dot-sep">·</span>
            {goalById(app.goalId).title}
          </p>
        </div>
        <ClientStatusBadge app={app} size="lg" />
      </div>
      <div className="current__body">
        <div className="metrics">
          <div className="metric">
            <span className="metric__label">Сумма</span>
            <span className="metric__value">{rub(terms.amount)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">Срок</span>
            <span className="metric__value">{months(terms.term)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">{main.label}</span>
            <span className="metric__value">{rub(main.value)}</span>
          </div>
        </div>
        <div className="current__next">
          <p>
            <strong>Что дальше: </strong>
            {clientNextStep(app)}
          </p>
          <button type="button" className={`btn ${action ? 'btn--primary' : 'btn--outline'} btn--block`} onClick={() => open(app)}>
            {action ?? 'Открыть заявку'} <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>
      <StageProgress status={app.status} compact />
    </section>
  );
}

export const isActive = (a: Application) => a.status !== 'DRAFT' && !isFinal(a.status);
