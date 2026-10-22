import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import Modal from '../../components/Modal';
import { GoalIllustration } from '../../art/GoalIllustration';
import { MascotHead } from '../../art/Mascot';
import { api } from '../../api';
import { GOALS, goalById, productById, type Goal } from '../../config/products';
import { useAction, useDb, useUser } from '../../store/data';
import { dateTime, months, rub, shortAmount } from '../../utils/format';
import { COLLATERAL, PURPOSES, RETURNS, suggestGoals, type QuizAnswers, type Suggestion } from './goalQuiz';

function productLine(goal: Goal) {
  const p = productById(goal.productId);
  return `${shortAmount(p.minAmount)} – ${shortAmount(p.maxAmount)} ₽ · ${p.minTerm}–${p.maxTerm} мес. · от ${p.baseRate}%`;
}

export default function FinancingPage() {
  const user = useUser();
  const db = useDb();
  const navigate = useNavigate();
  const { run, pending, error } = useAction();
  const wizard = api.applications.getWizard(user.id);
  const drafts = db.applications.filter((a) => a.ownerUserId === user.id && a.status === 'DRAFT');
  const [quizOpen, setQuizOpen] = useState(false);
  const [suggested, setSuggested] = useState<Suggestion[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const select = (goalId: string, subgoalId?: string) => run(() => api.applications.saveWizard(user.id, { goalId, subgoalId: subgoalId ?? goalById(goalId).subgoals[0]?.id }));

  const calculate = async () => {
    await run(() => api.applications.saveWizard(user.id, { step: 0 }));
    navigate('/financing/calculator');
  };

  return (
    <div className="financing">
      <h1 className="page-title">На что нужны деньги?</h1>
      <p className="page-subtitle">Выберите задачу — подберём подходящий кредит и сразу посчитаем платёж</p>
      {wizard.appId && (
        <p className="editing-note">
          Вы меняете черновик № {wizard.appId}.{' '}
          <button type="button" className="link-btn link-btn--red" onClick={() => run(() => api.applications.newWizard(user.id, { goalId: wizard.goalId }))}>
            Начать новую заявку
          </button>
        </p>
      )}

      <div className="goals" role="radiogroup" aria-label="Цель финансирования">
        {GOALS.map((g) => {
          const active = g.id === wizard.goalId;
          const product = productById(g.productId);
          const isSuggested = suggested.some((s) => s.goal.id === g.id);
          return (
            <article
              key={g.id}
              className={`goal-card${active ? ' is-active' : ''}${isSuggested ? ' is-suggested' : ''}`}
              onClick={() => !active && select(g.id)}
              role="radio"
              aria-checked={active}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !active && (e.preventDefault(), select(g.id))}
            >
              <span className="goal-card__check" aria-hidden="true">
                {active && <Icon name="check" size={14} strokeWidth={3} />}
              </span>
              {isSuggested && <span className="goal-card__tag">Подходит вам</span>}
              <GoalIllustration goal={g.illustration} className="goal-card__art" />
              <div className="goal-card__body">
                <h2 className="goal-card__title">{g.title}</h2>
                <p className="goal-card__product">
                  {product.name} · {productLine(g)}
                </p>
                <p className="goal-card__desc">{product.description}</p>
                <p className={`goal-card__collateral${product.collateral.required ? ' is-required' : ''}`}>
                  <Icon name={product.collateral.required ? 'lock' : 'check'} size={14} /> {product.collateral.note}
                </p>
                {g.subgoals.length > 0 && (
                  <div className="goal-card__options" onClick={(e) => e.stopPropagation()}>
                    {g.subgoals.map((s) => (
                      <label key={s.id} className="radio">
                        <input type="radio" name={`sub-${g.id}`} checked={active && wizard.subgoalId === s.id} onChange={() => select(g.id, s.id)} />
                        <span className="radio__mark" />
                        {s.title}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        <article className="goal-card goal-card--quiz" onClick={() => setQuizOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setQuizOpen(true)}>
          <MascotHead size={84} className="goal-card__cat" />
          <div className="goal-card__body">
            <h2 className="goal-card__title">Не знаю, что выбрать</h2>
            <p className="goal-card__desc">Ответьте на три вопроса — подскажем 1–2 подходящих варианта и объясним почему.</p>
            <span className="link-btn link-btn--red">
              Подобрать <Icon name="arrowRight" size={16} />
            </span>
          </div>
        </article>
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
                    № {d.id} · {goalById(d.goalId).title} · {rub(d.requested.amount)} · {months(d.requested.term)}
                    <small>Сохранена {dateTime(d.updatedAt)}</small>
                  </span>
                  <button
                    type="button"
                    className="link-btn link-btn--red"
                    onClick={async () => {
                      await run(() => api.applications.resumeDraft(user.id, d.id));
                      navigate('/financing/calculator');
                    }}
                  >
                    Продолжить <Icon name="arrowRight" size={16} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Удалить черновик № ${d.id}`} onClick={() => setConfirmDelete(d.id)}>
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
              <strong>Сумму, срок и тип платежа настроите на следующем шаге</strong>
              <span className="muted">Реквизиты компании подтянем из ЕГРЮЛ, обороты — из выписки, вводить их вручную не нужно.</span>
            </div>
          </section>
        )}
        <button type="button" className="btn btn--cta" onClick={calculate} disabled={pending}>
          Рассчитать условия <Icon name="arrowRight" size={22} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="micro">Ставки ориентировочные. Точные условия банк назовёт после проверки заявки.</p>

      {quizOpen && (
        <GoalQuiz
          onClose={() => setQuizOpen(false)}
          onResult={setSuggested}
          onPick={async (goalId) => {
            setQuizOpen(false);
            await select(goalId);
          }}
        />
      )}

      {confirmDelete && (
        <Modal title="Удалить черновик?" onClose={() => setConfirmDelete(null)}>
          <p>Черновик № {confirmDelete} и все введённые в нём данные будут удалены. Это нельзя отменить.</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline" onClick={() => setConfirmDelete(null)}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={async () => {
                await run(() => api.applications.deleteDraft(user.id, confirmDelete));
                setConfirmDelete(null);
              }}
            >
              Удалить черновик
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GoalQuiz({ onClose, onResult, onPick }: { onClose: () => void; onResult: (s: Suggestion[]) => void; onPick: (goalId: string) => void }) {
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const result = suggestGoals(answers);

  const question = <K extends keyof QuizAnswers>(key: K, title: string, options: readonly { id: string; label: string }[]) => (
    <fieldset className="quiz__q">
      <legend>{title}</legend>
      <div className="quiz__options">
        {options.map((o) => (
          <label key={o.id} className={`quiz__opt${answers[key] === o.id ? ' is-active' : ''}`}>
            <input
              type="radio"
              name={key}
              checked={answers[key] === o.id}
              onChange={() => {
                const next = { ...answers, [key]: o.id };
                setAnswers(next);
                onResult(suggestGoals(next));
              }}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Modal title="Подберём цель" onClose={onClose} wide>
      {question('purpose', '1. Для чего нужны деньги?', PURPOSES)}
      {question('returns', '2. Когда планируете вернуть?', RETURNS)}
      {question('collateral', '3. Есть ли имущество для залога?', COLLATERAL)}
      {result.length > 0 && (
        <div className="quiz__result" aria-live="polite">
          <h3 className="card-title">Вам подойдёт</h3>
          {result.map((s) => (
            <div key={s.goal.id} className="quiz__suggestion">
              <div>
                <strong>{s.goal.title}</strong>
                <span className="muted"> · {productById(s.goal.productId).name}</span>
                <ul>
                  {s.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => onPick(s.goal.id)}>
                Выбрать
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
