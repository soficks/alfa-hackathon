import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import StageProgress from '../../components/StageProgress';
import { ClientStatusBadge } from '../../components/StatusBadge';
import PaymentTypePicker from '../../components/PaymentType';
import Field from '../../components/Field';
import { ScheduleModal } from '../../components/Schedule';
import { TermsCompare, TermsMetrics } from '../../components/Terms';
import { DocList, DocPreview, UploadButton, demoFile } from '../../components/Docs';
import { HistoryList, MessagesThread } from '../../components/Thread';
import { api } from '../../api';
import { ALL_DOC_TYPES, DOC_TYPES } from '../../config/docTypes';
import { AMOUNT_STEP, goalById, productById, subgoalTitle } from '../../config/products';
import { rejectReason } from '../../config/rejectReasons';
import { accountsFor } from '../../domain/accounts';
import { canMessage, isChecking, isEditable, isWithdrawable } from '../../domain/stateMachine';
import { clientNeedsAction, clientNextStep } from '../../domain/statusText';
import type { Application, DocFile, DocType, PaymentType } from '../../domain/types';
import { useAction, useApplication, useDb, useNow, useUser } from '../../store/data';
import { dateTime, dayMonth, fullDate, rub } from '../../utils/format';
import { UnreadBadge, termsOf } from './common';

export default function ApplicationPage() {
  const { id } = useParams();
  const user = useUser();
  const app = useApplication(id);
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [preview, setPreview] = useState<DocFile | null>(null);
  const withdrawAction = useAction();

  // Открыли карточку — сообщения и запросы прочитаны
  useEffect(() => {
    if (app) api.applications.markSeen(app.id, user.id);
  }, [app?.id, app?.messages.length, app?.docRequests.length, user.id]);

  // Переход из колокольчика к нужному блоку
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, app?.id]);

  if (!app || app.ownerUserId !== user.id) return <Navigate to="/applications" replace />;
  if (app.status === 'DRAFT') return <Navigate to="/financing" replace />;

  const goal = goalById(app.goalId);
  const product = productById(app.productId);
  const terms = termsOf(app);

  return (
    <div className="details">
      <Link to="/applications" className="back-link">
        <Icon name="arrowLeft" size={16} /> Все заявки
      </Link>
      <div className="details__head">
        <div>
          <div className="details__title-row">
            <h1 className="page-title">{goal.title}</h1>
            <ClientStatusBadge app={app} size="lg" />
            <UnreadBadge app={app} />
          </div>
          <p className="page-subtitle">
            № {app.id} · {product.name}
            {app.subgoalId ? ` · ${subgoalTitle(app.goalId, app.subgoalId)}` : ''} · подана {fullDate(app.submittedAt ?? app.createdAt)}
          </p>
        </div>
        <div className="details__actions">
          {isEditable(app.status) && (
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={16} /> Изменить условия
            </button>
          )}
          {isWithdrawable(app.status) && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setWithdrawing(true)}>
              Отозвать заявку
            </button>
          )}
        </div>
      </div>

      <section className="card details__stage">
        <StageProgress status={app.status} />
        <div className={`next-step${clientNeedsAction(app) ? ' next-step--action' : app.status === 'REJECTED' ? ' next-step--fail' : ''}`}>
          <Icon name={app.status === 'ISSUED' ? 'checkCircle' : clientNeedsAction(app) ? 'alert' : 'info'} size={20} />
          <span>
            <strong>Что дальше: </strong>
            {clientNextStep(app)}
          </span>
        </div>
        {isChecking(app.status) && <AutoChecks app={app} />}
      </section>

      <div className="details__grid">
        <div className="details__main">
          <DecisionBlock app={app} onSchedule={() => setScheduleOpen(true)} />

          {app.docRequests.length > 0 && <RequestsBlock app={app} />}

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{app.decision?.terms ? 'Запрошенные условия' : 'Условия'}</h2>
              <button type="button" className="link-btn" onClick={() => setScheduleOpen(true)}>
                <Icon name="calendar" size={16} /> График платежей
              </button>
            </div>
            <TermsMetrics terms={app.requested} rateLabel="Ставка (ориентир.)" />
            {app.changes.length > 0 && <p className="micro">Условия менялись после отправки: версия {app.version}.</p>}
          </section>

          <section className="card" id="messages">
            <h2 className="card-title">Сообщения по заявке</h2>
            <p className="muted form-note">Переписка со специалистом, который проверяет заявку.</p>
            <MessagesThread
              app={app}
              canWrite={canMessage(app.status)}
              hint={
                !canMessage(app.status)
                  ? 'Переписка закрыта: заявка завершена.'
                  : !app.assigneeId
                    ? 'Специалист ответит, когда возьмёт заявку в работу.'
                    : undefined
              }
            />
          </section>

          <section className="card">
            <h2 className="card-title">История</h2>
            <HistoryList events={app.history} role="client" />
          </section>
        </div>

        <aside className="details__side">
          <DocumentsBlock app={app} onOpen={setPreview} />
          <section className="card company-short">
            <span className="mini-label">Компания</span>
            <strong>{app.company.name}</strong>
            <span className="muted">
              ИНН {app.company.inn} · {app.company.form === 'ИП' ? 'ОГРНИП' : 'ОГРН'} {app.company.ogrn}
            </span>
          </section>
        </aside>
      </div>

      {scheduleOpen && <ScheduleModal terms={terms} onClose={() => setScheduleOpen(false)} title={app.decision?.terms ? 'График по итоговым условиям' : 'График платежей'} />}
      {preview && <DocPreview doc={preview} onClose={() => setPreview(null)} />}
      {editing && <EditTermsModal app={app} onClose={() => setEditing(false)} />}
      {withdrawing && (
        <ConfirmModal
          title="Отозвать заявку?"
          confirmLabel="Отозвать заявку"
          danger
          pending={withdrawAction.pending}
          error={withdrawAction.error}
          onClose={() => setWithdrawing(false)}
          onConfirm={async () => {
            const ok = await withdrawAction.run(() => api.applications.withdraw(app.id, user.id));
            if (ok) setWithdrawing(false);
          }}
        >
          <p>Проверка остановится, а специалист увидит, что вы отозвали заявку. Вернуть её нельзя — но можно подать новую.</p>
        </ConfirmModal>
      )}
    </div>
  );
}

/* ---------- Авто-проверки в реальном времени ---------- */

function AutoChecks({ app }: { app: Application }) {
  const steps = app.pipeline?.steps ?? [];
  const running = steps.find((s) => s.status === 'pending')?.id;
  return (
    <ol className="checks-live" aria-live="polite" aria-label="Автоматические проверки">
      {steps.map((s) => (
        <li key={s.id} className={`checks-live__step is-${s.status === 'pending' ? (s.id === running ? 'running' : 'todo') : s.status}`}>
          <span className="checks-live__icon">
            {s.status === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : s.status === 'fail' ? <Icon name="close" size={12} strokeWidth={3} /> : null}
          </span>
          {s.title}
        </li>
      ))}
    </ol>
  );
}

/* ---------- Решение банка ---------- */

function DecisionBlock({ app, onSchedule }: { app: Application; onSchedule: () => void }) {
  const user = useUser();
  const navigate = useNavigate();
  const { run, pending, error } = useAction();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const d = app.decision;

  const newApplication = async () => {
    const ok = await run(() => api.applications.startFromApplication(user.id, app.id));
    if (ok) navigate('/financing/calculator');
  };

  if (app.status === 'APPROVED' && d?.terms) {
    return (
      <section className="card decision decision--ok" id="decision">
        <span className="mini-label">Решение банка</span>
        <h2 className="card-title">Заявка одобрена</h2>
        <p>{d.clientMessage}</p>
        <TermsMetrics terms={d.terms} />
        {d.validUntil && <p className="decision__valid">Предложение действует до {dayMonth(d.validUntil)}.</p>}
        <div className="decision__actions">
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => run(() => api.applications.accept(app.id, user.id))}>
            Принять условия <Icon name="arrowRight" size={18} />
          </button>
          <button type="button" className="link-btn" onClick={onSchedule}>
            <Icon name="calendar" size={16} /> График платежей
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }

  if (app.status === 'COUNTER_OFFER' && d?.terms) {
    return (
      <section className="card decision decision--offer" id="decision">
        <span className="mini-label">Встречное предложение</span>
        <h2 className="card-title">Банк предлагает другие условия</h2>
        <p>{d.clientMessage}</p>
        <TermsCompare requested={app.requested} offered={d.terms} />
        {d.validUntil && <p className="decision__valid">Предложение действует до {dayMonth(d.validUntil)}.</p>}
        <div className="decision__actions">
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => run(() => api.applications.accept(app.id, user.id))}>
            Принять предложение <Icon name="arrowRight" size={18} />
          </button>
          <button type="button" className="btn btn--outline" onClick={() => setDeclining(true)}>
            Отказаться
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {declining && (
          <ConfirmModal
            title="Отказаться от предложения?"
            confirmLabel="Отказаться"
            danger
            pending={pending}
            error={error}
            onClose={() => setDeclining(false)}
            onConfirm={async () => {
              const ok = await run(() => api.applications.decline(app.id, user.id, reason));
              if (ok) setDeclining(false);
            }}
          >
            <p>Заявка завершится. Потом можно подать новую — с другой суммой или сроком.</p>
            <Field label="Почему не подошло? (необязательно)">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: нужна вся сумма сразу" />
            </Field>
          </ConfirmModal>
        )}
      </section>
    );
  }

  if (app.status === 'SIGNING' && d?.terms) return <SigningBlock app={app} />;

  if (app.status === 'ISSUED' && app.issued) {
    return (
      <section className="card decision decision--ok" id="decision">
        <span className="mini-label">Кредит выдан</span>
        <h2 className="card-title">Деньги зачислены на счёт</h2>
        <p>
          {rub(termsOf(app).amount)} зачислены {dateTime(app.issued.issuedAt)} на счёт {app.issued.accountNumber}. Это симуляция: реальные деньги не перечисляются.
        </p>
        <TermsMetrics terms={termsOf(app)} />
        <button type="button" className="link-btn" onClick={onSchedule}>
          <Icon name="calendar" size={16} /> График платежей
        </button>
      </section>
    );
  }

  if (app.status === 'REJECTED' && d) {
    return (
      <section className="card decision decision--fail" id="decision">
        <span className="mini-label">Решение банка</span>
        <h2 className="card-title">К сожалению, сейчас кредит выдать не можем</h2>
        <p className="decision__reason">
          <strong>{rejectReason(d.reasonCode).title}.</strong> {d.clientMessage}
        </p>
        <button type="button" className="btn btn--primary" onClick={newApplication} disabled={pending}>
          Подать новую заявку <Icon name="arrowRight" size={18} />
        </button>
        <p className="micro">Цель, компания и финансы перенесутся — останется поменять условия.</p>
      </section>
    );
  }

  if (app.status === 'DECLINED_BY_CLIENT') {
    return (
      <section className="card decision" id="decision">
        <h2 className="card-title">Вы отказались от предложения</h2>
        {app.declineReason && <p className="muted">Причина: {app.declineReason}</p>}
        <button type="button" className="btn btn--outline" onClick={newApplication} disabled={pending}>
          Подать новую заявку
        </button>
      </section>
    );
  }

  return null;
}

function SigningBlock({ app }: { app: Application }) {
  const user = useUser();
  const db = useDb();
  const { run, pending, error } = useAction();
  const [read, setRead] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const accounts = accountsFor(app.company.inn, db.accounts);
  const [account, setAccount] = useState(accounts[0]?.number ?? '');
  const terms = termsOf(app);
  const docs = [`Кредитный договор № ${app.id}`, 'График платежей', 'Заявление на зачисление'];

  return (
    <section className="card decision decision--sign" id="decision">
      <span className="mini-label">Подписание · симуляция</span>
      <h2 className="card-title">{app.signedAt ? 'Выберите счёт для зачисления' : 'Подпишите документы'}</h2>
      {!app.signedAt ? (
        <>
          <ul className="sign-docs">
            {docs.map((d) => (
              <li key={d}>
                <Icon name="file" size={18} /> {d}
                <button type="button" className="link-btn link-btn--blue" onClick={() => setOpen(d)}>
                  Открыть
                </button>
              </li>
            ))}
          </ul>
          <label className="checkbox">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
            <span className="checkbox__mark">
              <Icon name="check" size={14} strokeWidth={3} />
            </span>
            Ознакомлен(а) с документами
          </label>
          <button type="button" className="btn btn--primary" disabled={!read || pending} onClick={() => run(() => api.applications.sign(app.id, user.id))}>
            <Icon name="pen" size={18} /> {pending ? 'Подписываем…' : 'Подписать (симуляция)'}
          </button>
          <p className="micro">Подпись симулируется: настоящая электронная подпись и документы не создаются.</p>
        </>
      ) : (
        <>
          <div className="accounts" role="radiogroup" aria-label="Счёт зачисления">
            {accounts.map((a) => (
              <label key={a.number} className={`account${account === a.number ? ' is-active' : ''}`}>
                <input type="radio" name="account" checked={account === a.number} onChange={() => setAccount(a.number)} />
                <span className="radio__mark" />
                <span>
                  <strong>{a.title}</strong>
                  <span className="muted">{a.number}</span>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn--primary" disabled={!account || pending} onClick={() => run(() => api.applications.issue(app.id, user.id, account))}>
            <Icon name="wallet" size={18} /> {pending ? 'Зачисляем…' : `Зачислить ${rub(terms.amount)}`}
          </button>
          <p className="micro">Зачисление симулируется — реальные деньги не перечисляются.</p>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      {open && (
        <Modal title={open} onClose={() => setOpen(null)}>
          <div className="doc-preview">
            <Icon name="file" size={40} />
            <p>Предпросмотр документа (заглушка). Ключевые условия:</p>
          </div>
          <TermsMetrics terms={terms} />
          <p className="micro">
            Заёмщик: {app.company.name}, ИНН {app.company.inn}. Документ сформирован для демонстрации.
          </p>
        </Modal>
      )}
    </section>
  );
}

/* ---------- Запросы документов ---------- */

function RequestsBlock({ app }: { app: Application }) {
  const user = useUser();
  const now = useNow();
  const { run, pending, error } = useAction();
  const editable = isEditable(app.status);
  return (
    <section className="card requests" id="requests">
      <h2 className="card-title">Запросы документов</h2>
      <ul className="requests__list">
        {app.docRequests.map((r) => {
          const doc = app.documents.find((d) => d.id === r.fulfilledByDocId);
          const overdue = !doc && new Date(r.dueAt) < now;
          return (
            <li key={r.id} className={`request${doc ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
              <div className="request__body">
                <strong>{DOC_TYPES[r.docType].title}</strong>
                {r.comment && <p className="request__comment">«{r.comment}» — {r.createdBy}</p>}
                <span className="request__due">
                  {doc ? `Загружено ${dateTime(r.fulfilledAt ?? doc.addedAt)}: ${doc.name}` : `${overdue ? 'Срок прошёл' : 'Загрузите до'} ${dayMonth(r.dueAt)}`}
                </span>
              </div>
              {doc ? (
                <span className="pill pill--ok">
                  <Icon name="checkCircle" size={16} /> Получено
                </span>
              ) : editable ? (
                <span className="request__actions">
                  <UploadButton docType={r.docType} variant="primary" disabled={pending} onFiles={(files) => run(() => api.applications.uploadDocuments(app.id, user.id, files, r.id))} />
                  <button type="button" className="link-btn" disabled={pending} onClick={() => run(() => api.applications.uploadDocuments(app.id, user.id, [demoFile(r.docType)], r.id))}>
                    Демо-файл
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

/* ---------- Документы ---------- */

function DocumentsBlock({ app, onOpen }: { app: Application; onOpen: (d: DocFile) => void }) {
  const user = useUser();
  const { run, pending, error } = useAction();
  const [type, setType] = useState<DocType>('other');
  const product = productById(app.productId);
  const missing = product.requiredDocs.filter((t) => !app.documents.some((d) => d.docType === t));
  return (
    <section className="card docs">
      <h2 className="card-title">Документы · {app.documents.length}</h2>
      <DocList docs={app.documents} onOpen={onOpen} showSource />
      {missing.length > 0 && !['REJECTED', 'WITHDRAWN', 'DECLINED_BY_CLIENT'].includes(app.status) && (
        <p className="muted form-note">Не хватает для продукта: {missing.map((t) => DOC_TYPES[t].short.toLowerCase()).join(', ')}.</p>
      )}
      {isEditable(app.status) && (
        <div className="add-doc">
          <Field label="Добавить документ">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as DocType)}>
              {ALL_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPES[t].title}
                </option>
              ))}
            </select>
          </Field>
          <UploadButton docType={type} disabled={pending} onFiles={(files) => run(() => api.applications.uploadDocuments(app.id, user.id, files))} />
          {app.status === 'IN_QUEUE' && <p className="micro">Новый документ запустит повторные авто-проверки.</p>}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

/* ---------- Изменение условий после отправки ---------- */

function EditTermsModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const user = useUser();
  const product = productById(app.productId);
  const f = app.financials;
  const [amount, setAmount] = useState(app.requested.amount);
  const [term, setTerm] = useState(app.requested.term);
  const [paymentType, setPaymentType] = useState<PaymentType>(app.requested.paymentType);
  const [grace, setGrace] = useState(app.requested.graceMonths);
  const [revenue, setRevenue] = useState(f?.revenue12m ?? 0);
  const [debt, setDebt] = useState(f?.existingDebt ?? 0);
  const [monthly, setMonthly] = useState(f?.existingMonthlyPayments ?? 0);
  const { run, pending, error, setError } = useAction();

  const save = async () => {
    if (amount < product.minAmount || amount > product.maxAmount || amount % AMOUNT_STEP) {
      return setError(`Сумма — от ${rub(product.minAmount)} до ${rub(product.maxAmount)}, кратно 50 000 ₽`);
    }
    if (term < product.minTerm || term > product.maxTerm) return setError(`Срок — от ${product.minTerm} до ${product.maxTerm} мес.`);
    const ok = await run(() =>
      api.applications.updateByClient(app.id, user.id, {
        requested: { amount, term, paymentType, graceMonths: paymentType === 'annuity_grace' ? grace : undefined },
        financials: f ? { revenue12m: revenue, existingDebt: debt, existingMonthlyPayments: monthly } : undefined,
      }),
    );
    if (ok) onClose();
  };

  const num = (v: string) => Number(v.replace(/\D/g, ''));

  return (
    <Modal title="Изменить условия заявки" onClose={onClose} wide>
      <div className="notice notice--warm">
        <Icon name="info" size={18} />
        {app.status === 'IN_QUEUE'
          ? 'Заявку проверим заново — это займёт несколько секунд. Компанию изменить нельзя.'
          : 'Специалист увидит, что именно вы изменили, а оценка заявки пересчитается. Компанию изменить нельзя.'}
      </div>
      <div className="form-grid">
        <Field label={`Сумма, ₽ (${rub(product.minAmount)} – ${rub(product.maxAmount)})`}>
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
        </Field>
        <Field label={`Срок, мес. (${product.minTerm}–${product.maxTerm})`}>
          <input className="input" inputMode="numeric" value={term} onChange={(e) => setTerm(num(e.target.value))} />
        </Field>
      </div>
      <h3 className="form-label">Тип платежа</h3>
      <PaymentTypePicker
        product={product}
        value={paymentType}
        graceMonths={grace}
        name="edit-payment"
        onChange={(t, g) => {
          setPaymentType(t);
          setGrace(g);
        }}
      />
      {f && (
        <>
          <h3 className="form-label">Финансы</h3>
          <div className="form-grid form-grid--3">
            <Field label="Выручка за 12 мес., ₽">
              <input className="input" inputMode="numeric" value={revenue} onChange={(e) => setRevenue(num(e.target.value))} />
            </Field>
            <Field label="Долг по кредитам, ₽">
              <input className="input" inputMode="numeric" value={debt} onChange={(e) => setDebt(num(e.target.value))} />
            </Field>
            <Field label="Платежи по ним, ₽/мес.">
              <input className="input" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(num(e.target.value))} />
            </Field>
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal__actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
      </div>
    </Modal>
  );
}
