import { useState } from 'react';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import { Icon } from '../../components/Icon';
import PaymentTypePicker from '../../components/PaymentType';
import { TermsCompare } from '../../components/Terms';
import { api } from '../../api';
import { ALL_DOC_TYPES, DOC_TYPES } from '../../config/docTypes';
import { AMOUNT_STEP, DOC_REQUEST_DAYS, OFFER_VALID_DAYS, productById, rateBounds } from '../../config/products';
import { MANUAL_REJECT_REASONS, rejectReason } from '../../config/rejectReasons';
import { calculateSchedule, paymentSummary } from '../../domain/finance';
import { addBusinessDays } from '../../domain/time';
import type { Application, DocType, Terms } from '../../domain/types';
import { useAction, useUser } from '../../store/data';
import { rub } from '../../utils/format';
import { missingDocTypes } from './derive';

const MIN_JUSTIFICATION = 20;
const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ModalActions({ onClose, label, pending, disabled, onSubmit, danger }: { onClose: () => void; label: string; pending: boolean; disabled?: boolean; onSubmit: () => void; danger?: boolean }) {
  return (
    <div className="modal__actions">
      <button type="button" className="btn btn--outline" onClick={onClose}>
        Отмена
      </button>
      <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onSubmit} disabled={pending || disabled}>
        {pending ? 'Сохраняем…' : label}
      </button>
    </div>
  );
}

/* ---------- Запросить документы ---------- */

export function RequestDocsModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const user = useUser();
  const missing = missingDocTypes(app);
  const [checked, setChecked] = useState<DocType[]>(missing);
  const [comments, setComments] = useState<Partial<Record<DocType, string>>>({});
  const [common, setCommon] = useState('');
  const [due, setDue] = useState(toDateInput(addBusinessDays(new Date(), DOC_REQUEST_DAYS)));
  const { run, pending, error, setError } = useAction();

  const submit = async () => {
    if (!checked.length) return setError('Отметьте хотя бы один документ');
    const dueAt = new Date(`${due}T18:00:00`);
    if (Number.isNaN(dueAt.getTime()) || dueAt < new Date()) return setError('Срок ответа должен быть в будущем');
    const items = checked.map((t) => ({ docType: t, comment: (comments[t] ?? '').trim() || common.trim() }));
    const ok = await run(() => api.applications.requestDocuments(app.id, user.id, items, dueAt.toISOString()));
    if (ok) onClose();
  };

  return (
    <Modal title="Запросить документы" onClose={onClose} wide>
      <p className="muted form-note">Клиент увидит запрос с типом и сроком и сможет загрузить документ в один клик. Недостающие обязательные документы отмечены заранее.</p>
      <ul className="req-list">
        {ALL_DOC_TYPES.map((t) => {
          const on = checked.includes(t);
          return (
            <li key={t} className={on ? 'is-on' : ''}>
              <label className="checkbox">
                <input type="checkbox" checked={on} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, t] : c.filter((x) => x !== t)))} />
                <span className="checkbox__mark">
                  <Icon name="check" size={14} strokeWidth={3} />
                </span>
                {DOC_TYPES[t].title}
                {missing.includes(t) && <span className="flag flag--changed">обязательный, нет</span>}
                {app.documents.some((d) => d.docType === t) && <span className="flag">уже есть</span>}
              </label>
              {on && (
                <input
                  className="input input--sm"
                  placeholder="Комментарий для клиента: что именно нужно"
                  value={comments[t] ?? ''}
                  onChange={(e) => setComments((c) => ({ ...c, [t]: e.target.value }))}
                  aria-label={`Комментарий: ${DOC_TYPES[t].title}`}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="form-grid">
        <Field label="Общий комментарий (если у документа нет своего)">
          <input className="input" value={common} onChange={(e) => setCommon(e.target.value)} />
        </Field>
        <Field label="Ответ до" hint={`По умолчанию +${DOC_REQUEST_DAYS} рабочих дня`}>
          <input className="input" type="date" value={due} min={toDateInput(new Date())} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {error && <p className="form-error">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} label={`Запросить (${checked.length})`} disabled={!checked.length} />
    </Modal>
  );
}

/* ---------- Отказать ---------- */

export function RejectModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const user = useUser();
  const [code, setCode] = useState(MANUAL_REJECT_REASONS[0].code);
  const [justification, setJustification] = useState('');
  const [message, setMessage] = useState(MANUAL_REJECT_REASONS[0].clientMessage);
  const [edited, setEdited] = useState(false);
  const { run, pending, error } = useAction();

  const submit = async () => {
    const ok = await run(() => api.applications.reject(app.id, user.id, { reasonCode: code, justification, clientMessage: message }));
    if (ok) onClose();
  };

  return (
    <Modal title="Отказать в кредите" onClose={onClose} wide>
      <fieldset className="reason-list">
        <legend className="form-label">Причина</legend>
        {MANUAL_REJECT_REASONS.map((r) => (
          <label key={r.code} className="radio">
            <input
              type="radio"
              name="reason"
              checked={code === r.code}
              onChange={() => {
                setCode(r.code);
                if (!edited) setMessage(r.clientMessage);
              }}
            />
            <span className="radio__mark" />
            {r.title}
          </label>
        ))}
      </fieldset>
      <Field label="Внутреннее обоснование (видит только банк)" error={justification.length > 0 && justification.trim().length < MIN_JUSTIFICATION ? `Ещё ${MIN_JUSTIFICATION - justification.trim().length} симв.` : undefined}>
        <textarea className="input textarea" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Почему отказ: факты из проверки" />
      </Field>
      <Field label="Сообщение клиенту" hint="Вежливый текст по выбранной причине — можно поправить">
        <textarea
          className="input textarea"
          rows={4}
          value={message}
          onChange={(e) => {
            setEdited(true);
            setMessage(e.target.value);
          }}
        />
      </Field>
      <p className="micro">Причина для клиента: «{rejectReason(code).title}». Заявка завершится, клиент сможет подать новую.</p>
      {error && <p className="form-error">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} label="Отказать" danger disabled={justification.trim().length < MIN_JUSTIFICATION || !message.trim()} />
    </Modal>
  );
}

/* ---------- Решение ---------- */

export function DecisionModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const user = useUser();
  const product = productById(app.productId);
  const bounds = rateBounds(product);
  const recommended = app.recommendation?.type === 'counter_offer' ? app.recommendation.amount : undefined;
  const [mode, setMode] = useState<'approve' | 'counter_offer'>(app.recommendation?.type === 'counter_offer' ? 'counter_offer' : 'approve');
  const [approveRate, setApproveRate] = useState(app.requested.rate);
  const [offer, setOffer] = useState<Terms>({ ...app.requested, amount: recommended ?? app.requested.amount });
  const [validDays, setValidDays] = useState(OFFER_VALID_DAYS);
  const [justification, setJustification] = useState('');
  const [message, setMessage] = useState('');
  const { run, pending, error } = useAction();

  const terms: Terms = mode === 'approve' ? { ...app.requested, rate: approveRate } : offer;
  const invalid = (() => {
    if (terms.rate < bounds.min || terms.rate > bounds.max) return `Ставка — от ${bounds.min} до ${bounds.max}%`;
    if (terms.amount < product.minAmount || terms.amount > product.maxAmount || terms.amount % AMOUNT_STEP) return `Сумма — от ${rub(product.minAmount)} до ${rub(product.maxAmount)}, кратно 50 000 ₽`;
    if (terms.term < product.minTerm || terms.term > product.maxTerm) return `Срок — от ${product.minTerm} до ${product.maxTerm} мес.`;
    if (mode === 'counter_offer' && JSON.stringify({ ...terms }) === JSON.stringify({ ...app.requested })) return 'Встречное предложение должно отличаться от запроса';
    if (validDays < 1 || validDays > 30) return 'Срок действия — от 1 до 30 дней';
    return null;
  })();

  const schedule = invalid ? null : calculateSchedule(terms);
  const num = (v: string) => Number(v.replace(/[^\d.,]/g, '').replace(',', '.'));

  const submit = async () => {
    const ok = await run(() => api.applications.decide(app.id, user.id, { type: mode, terms, validDays, justification, clientMessage: message }));
    if (ok) onClose();
  };

  return (
    <Modal title="Решение по заявке" onClose={onClose} wide>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Тип решения">
        <button type="button" role="radio" aria-checked={mode === 'approve'} className={mode === 'approve' ? 'is-active' : ''} onClick={() => setMode('approve')}>
          Одобрить на запрошенных условиях
        </button>
        <button type="button" role="radio" aria-checked={mode === 'counter_offer'} className={mode === 'counter_offer' ? 'is-active' : ''} onClick={() => setMode('counter_offer')}>
          Предложить другие условия
        </button>
      </div>
      {app.recommendation && (
        <p className="recommend-line">
          <Icon name="sparkle" size={16} /> {app.recommendation.text}
        </p>
      )}

      {mode === 'approve' ? (
        <div className="form-grid">
          <Field label={`Ставка, % (${bounds.min}–${bounds.max})`} hint={app.scoring && app.scoring.score >= 800 ? 'Балл ≥ 800 — можно снизить ставку на 1 п.п.' : undefined}>
            <input className="input" inputMode="decimal" value={approveRate} onChange={(e) => setApproveRate(num(e.target.value))} />
          </Field>
        </div>
      ) : (
        <>
          <div className="form-grid form-grid--3">
            <Field label="Сумма, ₽" hint={recommended ? `Рекомендовано: до ${rub(recommended)}` : undefined}>
              <input className="input" inputMode="numeric" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: num(e.target.value) })} />
            </Field>
            <Field label={`Срок, мес. (${product.minTerm}–${product.maxTerm})`}>
              <input className="input" inputMode="numeric" value={offer.term} onChange={(e) => setOffer({ ...offer, term: num(e.target.value) })} />
            </Field>
            <Field label={`Ставка, % (${bounds.min}–${bounds.max})`}>
              <input className="input" inputMode="decimal" value={offer.rate} onChange={(e) => setOffer({ ...offer, rate: num(e.target.value) })} />
            </Field>
          </div>
          <h3 className="form-label">Тип платежа</h3>
          <PaymentTypePicker
            product={product}
            value={offer.paymentType}
            graceMonths={offer.graceMonths}
            name="offer-payment"
            onChange={(paymentType, graceMonths) => setOffer({ ...offer, paymentType, graceMonths })}
          />
        </>
      )}

      {schedule && (
        <div className="decision-preview">
          {paymentSummary(terms, schedule).map((x) => (
            <span key={x.label}>
              {x.label}: <strong>{rub(x.value)}</strong>
            </span>
          ))}
          <span>
            Переплата: <strong>{rub(schedule.overpayment)}</strong>
          </span>
          {app.financials && (
            <span>
              Платёж / оборот за 3 мес.: <strong>{Math.round((schedule.maxPayment / app.financials.avgTurnover3m) * 100)}%</strong>
            </span>
          )}
        </div>
      )}
      {mode === 'counter_offer' && !invalid && <TermsCompare requested={app.requested} offered={terms} leftLabel="Клиент просил" rightLabel="Предлагаем" />}

      <div className="form-grid">
        <Field label="Предложение действует, дней">
          <input className="input" inputMode="numeric" value={validDays} onChange={(e) => setValidDays(num(e.target.value))} />
        </Field>
      </div>
      <Field label="Обоснование (внутреннее, обязательно)" error={justification.length > 0 && justification.trim().length < MIN_JUSTIFICATION ? `Ещё ${MIN_JUSTIFICATION - justification.trim().length} симв.` : undefined}>
        <textarea className="input textarea" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="На чём основано решение: обороты, нагрузка, документы" />
      </Field>
      <Field label="Сообщение клиенту (необязательно)">
        <textarea className="input textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Например: «Можем выдать 3 млн — так платёж будет комфортнее»" />
      </Field>
      {(invalid || error) && <p className="form-error">{invalid ?? error}</p>}
      <ModalActions
        onClose={onClose}
        onSubmit={submit}
        pending={pending}
        disabled={!!invalid || justification.trim().length < MIN_JUSTIFICATION}
        label={mode === 'approve' ? 'Одобрить' : 'Отправить предложение'}
      />
    </Modal>
  );
}
