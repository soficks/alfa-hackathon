import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Modal from '../components/Modal';
import Schedule from '../components/Schedule';
import StatusBadge from '../components/StatusBadge';
import StatusProgress from '../components/StatusProgress';
import UploadBox from '../components/UploadBox';
import { TRANSITIONS, STATUS_LABEL, goalById, nextStepText } from '../store/data';
import { useStore } from '../store/store';
import type { Application, AppStatus, DocFile } from '../store/types';
import { calculateLoan } from '../utils/finance';
import { dateTime, fileSize, fullDate, months, previousMonthName, rub } from '../utils/format';

function Conditions({ app }: { app: Application }) {
  const loan = calculateLoan(app.amount, app.term, app.rate);
  return (
    <dl className="conditions">
      <div>
        <dt>Сумма</dt>
        <dd>{rub(app.amount)}</dd>
      </div>
      <div>
        <dt>Срок</dt>
        <dd>{months(app.term)}</dd>
      </div>
      <div>
        <dt>Ставка</dt>
        <dd>{app.rate}% годовых</dd>
      </div>
      <div>
        <dt>Платёж в месяц</dt>
        <dd>{rub(loan.payment)}</dd>
      </div>
      <div>
        <dt>Переплата</dt>
        <dd>{rub(loan.overpayment)}</dd>
      </div>
    </dl>
  );
}

/** Демо-панель: двигает заявку по стейт-машине вместо backend. */
const DEMO_EVENTS: Partial<Record<AppStatus, { to: AppStatus; label: string; event: string; patch?: (a: Application) => Partial<Application> }[]>> = {
  SUBMITTED: [{ to: 'MANUAL_REVIEW', label: 'Передать специалисту', event: 'Заявка передана специалисту на рассмотрение' }],
  MANUAL_REVIEW: [
    { to: 'APPROVED', label: 'Одобрить', event: 'Заявка одобрена' },
    {
      to: 'COUNTER_OFFER',
      label: 'Встречное предложение',
      event: 'Банк подготовил встречное предложение',
      patch: (a) => ({ offer: { amount: Math.max(500_000, Math.round((a.amount * 0.8) / 50_000) * 50_000), term: a.term, rate: a.rate - 1 } }),
    },
    {
      to: 'NEED_INFO',
      label: 'Запросить документы',
      event: `Запрошена выписка по счёту за ${previousMonthName()}`,
      patch: () => ({ request: `выписку по счёту за ${previousMonthName()}` }),
    },
  ],
};

export default function ApplicationDetailsPage() {
  const { id } = useParams();
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [newDocs, setNewDocs] = useState<DocFile[]>([]);
  const [agree, setAgree] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [toast, setToast] = useState<string | null>((location.state as { toast?: string } | null)?.toast ?? null);
  const app = state.applications.find((a) => a.id === id);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!app) return <Navigate to="/applications" replace />;
  if (app.status === 'DRAFT') {
    return (
      <div className="details">
        <h1 className="page-title">Черновик № {app.id}</h1>
        <p className="page-subtitle">{nextStepText(app)}</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            dispatch({ type: 'wizard/resume', id: app.id });
            navigate('/financing/calculator');
          }}
        >
          Продолжить оформление <Icon name="arrowRight" size={18} />
        </button>
      </div>
    );
  }

  const goal = goalById(app.goal);
  const canUpload = !(app.status === 'APPROVED' && app.accepted);

  const sendDocs = () => {
    dispatch({ type: 'app/addDocuments', id: app.id, documents: newDocs });
    setToast(app.status === 'NEED_INFO' ? 'Документы получены — заявка снова на рассмотрении' : 'Документы добавлены к заявке');
    setNewDocs([]);
  };

  const accept = () => {
    if (!agree) return setAgreeError(true);
    dispatch({ type: 'app/accept', id: app.id });
    setToast('Условия приняты — кредит выдан в демо-режиме');
    setAgree(false);
  };

  return (
    <div className="details">
      <Link to="/applications" className="back-link">
        <Icon name="arrowLeft" size={16} /> Все заявки
      </Link>
      <div className="details__head">
        <h1 className="page-title">{goal.title}</h1>
        <StatusBadge app={app} size="lg" />
      </div>
      <p className="page-subtitle">
        № {app.id} · {goal.options[app.option]} · создана {fullDate(app.createdAt)}
      </p>

      <section className="card details__stage">
        <StatusProgress app={app} />
        <div className={`next-step${app.status === 'NEED_INFO' || app.status === 'COUNTER_OFFER' || (app.status === 'APPROVED' && !app.accepted) ? ' next-step--action' : ''}`}>
          <Icon name={app.status === 'APPROVED' && app.accepted ? 'checkCircle' : app.status === 'NEED_INFO' ? 'alert' : 'info'} size={20} />
          <span>
            <strong>Что дальше: </strong>
            {nextStepText(app)}
          </span>
        </div>
      </section>

      <div className="details__grid">
        <div className="details__main">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{app.status === 'COUNTER_OFFER' ? 'Ваш запрос' : 'Условия'}</h2>
              <button type="button" className="link-btn" onClick={() => setScheduleOpen(true)}>
                <Icon name="calendar" size={16} /> График платежей
              </button>
            </div>
            <Conditions app={app} />
          </section>

          {app.status === 'COUNTER_OFFER' && app.offer && (
            <section className="card offer">
              <span className="mini-label">Встречное предложение банка</span>
              <h2 className="card-title">Можем выдать на таких условиях</h2>
              <Conditions app={{ ...app, ...app.offer }} />
              <p className="muted">
                Сумма меньше запрошенной на {rub(app.amount - app.offer.amount)}, ставка ниже на {app.rate - app.offer.rate} п.п.
              </p>
              <AcceptBlock agree={agree} error={agreeError} onAgree={(v) => { setAgree(v); setAgreeError(false); }} onAccept={accept} label="Принять предложение" />
              <Link to="/help" className="link-btn">
                Обсудить с помощником <Icon name="arrowRight" size={16} />
              </Link>
            </section>
          )}

          {app.status === 'APPROVED' && !app.accepted && (
            <section className="card offer">
              <span className="mini-label">Решение банка</span>
              <h2 className="card-title">Заявка одобрена на запрошенных условиях</h2>
              <AcceptBlock agree={agree} error={agreeError} onAgree={(v) => { setAgree(v); setAgreeError(false); }} onAccept={accept} label="Принять условия" />
            </section>
          )}

          <section className="card">
            <h2 className="card-title">История</h2>
            <ol className="timeline">
              {[...app.history].reverse().map((event, i) => (
                <li key={`${event.date}-${i}`} className={i === 0 ? 'is-last' : ''}>
                  <span className="timeline__dot" />
                  <strong>{event.text}</strong>
                  <small>{dateTime(event.date)}</small>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="details__side">
          <section className={`card docs${app.status === 'NEED_INFO' ? ' docs--attention' : ''}`}>
            <h2 className="card-title">Документы</h2>
            {app.status === 'NEED_INFO' && (
              <div className="notice notice--warm">
                <Icon name="alert" size={18} />
                Банк запросил {app.request ?? 'дополнительные документы'}.
              </div>
            )}
            {app.documents.length ? (
              <ul className="doc-list">
                {app.documents.map((d) => (
                  <li key={d.id} className="doc-item">
                    <Icon name="file" size={20} className="doc-item__icon" />
                    <div className="doc-item__text">
                      <strong>{d.name}</strong>
                      <span>
                        {fileSize(d.size)} · {dateTime(d.addedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Документы пока не добавлены.</p>
            )}

            {canUpload && (
              <>
                <h3 className="form-label">{app.status === 'NEED_INFO' ? 'Загрузить запрошенное' : 'Дозагрузить документы'}</h3>
                <UploadBox documents={newDocs} onChange={setNewDocs} title="Перетащите файлы" />
                <button type="button" className={`btn ${app.status === 'NEED_INFO' ? 'btn--primary' : 'btn--outline'} btn--block`} disabled={!newDocs.length} onClick={sendDocs}>
                  {app.status === 'NEED_INFO' ? 'Отправить документы' : 'Добавить к заявке'} <Icon name="arrowRight" size={18} />
                </button>
                {app.status === 'NEED_INFO' && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      setNewDocs((d) => [
                        ...d,
                        { id: crypto.randomUUID(), name: `Выписка за ${previousMonthName()}.pdf`, size: 186_000, addedAt: new Date().toISOString(), demo: true },
                      ])
                    }
                  >
                    Приложить демо-выписку
                  </button>
                )}
              </>
            )}
          </section>

          <section className="card company-short">
            <span className="mini-label">Компания</span>
            <strong>{app.company.name}</strong>
            <span className="muted">
              ИНН {app.company.inn} · {app.company.type === 'ИП' ? 'ОГРНИП' : 'ОГРН'} {app.company.ogrn}
            </span>
          </section>

          {DEMO_EVENTS[app.status] && (
            <section className="card demo-panel">
              <span className="mini-label">Демо: ответ банка</span>
              <p className="micro">Имитирует backend. Доступные переходы из «{STATUS_LABEL[app.status]}»: {TRANSITIONS[app.status].map((s) => STATUS_LABEL[s]).join(', ')}.</p>
              <div className="demo-panel__actions">
                {DEMO_EVENTS[app.status]!.map((e) => (
                  <button
                    key={e.to}
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => dispatch({ type: 'app/transition', id: app.id, to: e.to, event: e.event, patch: e.patch?.(app) })}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {scheduleOpen && (
        <Modal title="График платежей" onClose={() => setScheduleOpen(false)}>
          <p className="muted">
            {rub(app.amount)} · {months(app.term)} · {app.rate}% годовых
          </p>
          <Schedule calculation={calculateLoan(app.amount, app.term, app.rate)} />
        </Modal>
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="checkCircle" size={20} />
          {toast}
        </div>
      )}
    </div>
  );
}

function AcceptBlock({ agree, error, onAgree, onAccept, label }: { agree: boolean; error: boolean; onAgree: (v: boolean) => void; onAccept: () => void; label: string }) {
  return (
    <div className="accept">
      <label className="checkbox">
        <input type="checkbox" checked={agree} onChange={(e) => onAgree(e.target.checked)} />
        <span className="checkbox__mark">
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        Согласен с условиями (демо-режим, деньги не перечисляются)
      </label>
      {error && (
        <p className="form-error" role="alert">
          Отметьте согласие с условиями
        </p>
      )}
      <button type="button" className="btn btn--primary" onClick={onAccept}>
        {label} <Icon name="arrowRight" size={18} />
      </button>
    </div>
  );
}
