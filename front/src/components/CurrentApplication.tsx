import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import StatusBadge from './StatusBadge';
import StatusProgress from './StatusProgress';
import { actionLabel, goalById, needsAction, nextStepText } from '../store/data';
import { useStore } from '../store/store';
import type { Application } from '../store/types';
import { calculateLoan } from '../utils/finance';
import { months, rub } from '../utils/format';

export default function CurrentApplication({ app, title = 'Текущая заявка' }: { app: Application; title?: string }) {
  const { dispatch } = useStore();
  const navigate = useNavigate();
  const { payment } = calculateLoan(app.amount, app.term, app.rate);

  const open = () => {
    if (app.status === 'DRAFT') {
      dispatch({ type: 'wizard/resume', id: app.id });
      navigate('/financing/calculator');
    } else {
      navigate(`/applications/${app.id}`);
    }
  };

  return (
    <section className={`card current${needsAction(app) ? ' current--attention' : ''}`}>
      <div className="current__head">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="current__meta">
            № {app.id}
            <span className="dot-sep">·</span>
            {goalById(app.goal).title}
          </p>
        </div>
        <StatusBadge app={app} size="lg" />
      </div>

      <div className="current__body">
        <div className="metrics">
          <div className="metric">
            <span className="metric__label">Сумма</span>
            <span className="metric__value">{rub(app.amount)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">Срок</span>
            <span className="metric__value">{months(app.term)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">Платёж в месяц</span>
            <span className="metric__value">{rub(payment)}</span>
          </div>
        </div>
        <div className="current__next">
          <p>{nextStepText(app)}</p>
          <button type="button" className={`btn ${needsAction(app) || app.status === 'DRAFT' ? 'btn--primary' : 'btn--outline'} btn--block`} onClick={open}>
            {app.status === 'DRAFT' || needsAction(app) ? actionLabel(app) : 'Открыть заявку'}
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>

      <StatusProgress app={app} compact />
    </section>
  );
}
