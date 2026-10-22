import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { GoalIllustration } from '../art/GoalIllustration';
import { GOALS, goalById } from '../store/data';
import { useStore } from '../store/store';
import { dateTime, months, rub } from '../utils/format';

export default function FinancingPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { wizard } = state;
  const drafts = state.applications.filter((a) => a.status === 'DRAFT');

  const select = (goal: (typeof GOALS)[number]['id'], option: number) => dispatch({ type: 'wizard/patch', patch: { goal, option } });

  // Если открыт черновик, смена цели здесь — это правка того же черновика («Изменить цель»).
  const calculate = () => {
    dispatch({ type: 'wizard/patch', patch: { step: 0 } });
    navigate('/financing/calculator');
  };

  const resume = (id: string) => {
    dispatch({ type: 'wizard/resume', id });
    navigate('/financing/calculator');
  };

  return (
    <div className="financing">
      <h1 className="page-title">На что нужны деньги?</h1>
      <p className="page-subtitle">Выберите задачу — подберём финансирование под ваш бизнес</p>
      {wizard.appId && (
        <p className="editing-note">
          Вы меняете черновик № {wizard.appId}.{' '}
          <button type="button" className="link-btn" onClick={() => dispatch({ type: 'wizard/new', goal: wizard.goal })}>
            Начать новую заявку
          </button>
        </p>
      )}

      <div className="goals" role="radiogroup" aria-label="Цель финансирования">
        {GOALS.map((g) => {
          const active = g.id === wizard.goal;
          return (
            <article key={g.id} className={`goal-card${active ? ' is-active' : ''}`} onClick={() => !active && select(g.id, 0)}>
              <span className="goal-card__check" aria-hidden="true">
                {active && <Icon name="check" size={14} strokeWidth={3} />}
              </span>
              <GoalIllustration goal={g.id} className="goal-card__art" />
              <div className="goal-card__body">
                <h2 className="goal-card__title">{g.title}</h2>
                <p className="goal-card__desc">{g.description}</p>
                <div className="goal-card__options">
                  {g.options.map((label, i) => (
                    <label key={label} className="radio">
                      <input type="radio" name="goal-option" checked={active && wizard.option === i} onChange={() => select(g.id, i)} />
                      <span className="radio__mark" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="financing__bottom">
        {drafts.length > 0 ? (
          <section className="card drafts">
            <span className="tile-icon">
              <Icon name="document" size={22} />
            </span>
            <div className="drafts__body">
              <strong>{drafts.length === 1 ? 'Есть незавершённая заявка' : `Незавершённых заявок: ${drafts.length}`}</strong>
              {drafts.map((d) => (
                <div key={d.id} className="drafts__row">
                  <span>
                    № {d.id} · {goalById(d.goal).title} · {rub(d.amount)} · {months(d.term)}
                    <small>Сохранена {dateTime(d.updatedAt)}</small>
                  </span>
                  <button type="button" className="link-btn link-btn--red" onClick={() => resume(d.id)}>
                    Продолжить <Icon name="arrowRight" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={`Удалить черновик № ${d.id}`}
                    onClick={() => dispatch({ type: 'app/deleteDraft', id: d.id })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="card drafts">
            <span className="tile-icon">
              <Icon name="info" size={22} />
            </span>
            <div className="drafts__body">
              <strong>От замысла — к делу</strong>
              <span className="muted">Сумму и срок настроите на следующем шаге, платёж пересчитается сразу.</span>
            </div>
          </section>
        )}

        <button type="button" className="btn btn--cta" onClick={calculate}>
          Рассчитать условия <Icon name="arrowRight" size={22} />
        </button>
      </div>
      <p className="micro">Демонстрационные условия · без обращения в банк</p>
    </div>
  );
}
