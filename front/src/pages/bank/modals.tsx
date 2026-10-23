import { useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import { Icon } from '../../components/Icon';
import PaymentTypePicker from '../../components/PaymentType';
import { TermsCompare } from '../../components/Terms';
import { api } from '../../api';
import { ALL_DOC_TYPES, DOC_TYPES } from '../../config/docTypes';
import { AMOUNT_STEP, DOC_REQUEST_DAYS, OFFER_VALID_DAYS, productById, rateBounds } from '../../config/products';
import { MANUAL_REJECT_REASONS, rejectReason } from '../../config/rejectReasons';
import { DECISION_REASONS, WAIVER_REASONS, codeInfo } from '../../config/routeCodes';
import { calculateSchedule, paymentSummary } from '../../domain/finance';
import { addBusinessDays } from '../../domain/time';
import type { Application, DecisionDraft, DocType, Terms } from '../../domain/types';
import { useAction, useUser } from '../../store/data';
import { ratio, rub } from '../../utils/format';
import { missingDocTypes } from './derive';
import { debtCfZone, dscrZone, stressZone } from './assessment';

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

export type DecisionVariant = DecisionDraft['variant'];

const VARIANT_TITLE: Record<DecisionVariant, string> = {
  as_requested: 'Одобрить на запрошенных условиях',
  other_terms: 'Одобрить на других условиях',
  counter: 'Контрпредложение',
};

const VARIANT_NOTE: Record<DecisionVariant, string> = {
  as_requested: 'Сумма, срок, ставка и тип платежа — как просил клиент.',
  other_terms: 'Сумма и срок как в заявке; меняются ставка или тип платежа. Клиент подтвердит новые условия.',
  counter: 'Меняются сумма или срок. Клиент примет предложение или откажется.',
};

/** Метрика на выбранных условиях — цвет по тем же порогам, что в карточке */
function LiveMetric({ label, value, zone }: { label: string; value: string; zone: string }) {
  return (
    <span className={`live-metric live-metric--${zone}`}>
      {label} <strong>{value}</strong>
    </span>
  );
}

export function DecisionModal({ app, variant, onClose }: { app: Application; variant: DecisionVariant; onClose: () => void }) {
  const user = useUser();
  const product = productById(app.productId);
  const bounds = rateBounds(product);
  const type: DecisionDraft['type'] = variant === 'counter' ? 'counter_offer' : 'approve';
  const reasons = DECISION_REASONS[type];
  const suggested = app.recommendation?.type === 'counter_offer' ? app.recommendation.alternatives[0]?.terms : undefined;
  const [terms, setTerms] = useState<Terms>(variant === 'counter' && suggested ? { ...suggested } : { ...app.requested });
  const [reasonCode, setReasonCode] = useState<string>(reasons[0].code);
  const [validDays, setValidDays] = useState<number>(OFFER_VALID_DAYS);
  const [justification, setJustification] = useState('');
  const [message, setMessage] = useState('');
  const { run, pending, error } = useAction();
  const num = (v: string) => Number(v.replace(/[^\d.,]/g, '').replace(',', '.'));

  const invalid = (() => {
    if (terms.rate < bounds.min || terms.rate > bounds.max) return `Ставка — от ${bounds.min} до ${bounds.max}%`;
    if (terms.amount < product.minAmount || terms.amount > product.maxAmount || terms.amount % AMOUNT_STEP) return `Сумма — от ${rub(product.minAmount)} до ${rub(product.maxAmount)}, кратно 50 000 ₽`;
    if (terms.term < product.minTerm || terms.term > product.maxTerm) return `Срок — от ${product.minTerm} до ${product.maxTerm} мес.`;
    if (variant === 'other_terms' && terms.rate === app.requested.rate && terms.paymentType === app.requested.paymentType && terms.graceMonths === app.requested.graceMonths) {
      return 'Измените ставку или тип платежа — иначе это одобрение на запрошенных условиях';
    }
    if (variant === 'counter' && terms.amount === app.requested.amount && terms.term === app.requested.term) return 'Контрпредложение меняет сумму или срок';
    if (validDays < 1 || validDays > OFFER_VALID_DAYS) return `Срок действия — от 1 до ${OFFER_VALID_DAYS} дней`;
    return null;
  })();

  // Пересчёт на лету — расчётный слой (api.preview), компонент ничего не считает
  const preview = useMemo(() => (invalid ? null : api.applications.preview(app.id, terms, type)), [app.id, app.version, JSON.stringify(terms), type, invalid]);
  const schedule = invalid ? null : calculateSchedule(terms);
  const m = preview?.metrics;
  const blocked = !!preview?.blockers.length;
  const shortJustification = justification.trim().length < MIN_JUSTIFICATION;

  const submit = async () => {
    const draft: DecisionDraft = { type, variant, terms, reasonCode, validDays, justification, clientMessage: message };
    const ok = await run(() => api.applications.decide(app.id, user.id, draft));
    if (ok) onClose();
  };

  return (
    <Modal title={VARIANT_TITLE[variant]} onClose={onClose} wide>
      <p className="muted form-note">{VARIANT_NOTE[variant]}</p>
      {app.recommendation && (
        <p className="recommend-line">
          <Icon name="sparkle" size={16} /> {app.recommendation.text}
        </p>
      )}

      {variant === 'as_requested' && (
        <dl className="conditions conditions--compact">
          <div>
            <dt>Сумма</dt>
            <dd>{rub(terms.amount)}</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd>{terms.term} мес.</dd>
          </div>
          <div>
            <dt>Ставка</dt>
            <dd>{terms.rate}%</dd>
          </div>
        </dl>
      )}

      {variant === 'counter' && (
        <>
          <div className="form-grid form-grid--3">
            <Field
              label="Сумма, ₽"
              hint={preview ? `Не больше ${rub(preview.maxAllowed)} — лимит ${rub(preview.metrics.manualLimit)} + 10%` : undefined}
              error={preview && terms.amount > preview.maxAllowed ? `Выше допустимого ${rub(preview.maxAllowed)}` : undefined}
            >
              <input className="input" inputMode="numeric" value={terms.amount} onChange={(e) => setTerms({ ...terms, amount: num(e.target.value) })} />
            </Field>
            <Field label={`Срок, мес. (${product.minTerm}–${product.maxTerm})`}>
              <input className="input" inputMode="numeric" value={terms.term} onChange={(e) => setTerms({ ...terms, term: num(e.target.value) })} />
            </Field>
            <Field label={`Ставка, % (${bounds.min}–${bounds.max})`}>
              <input className="input" inputMode="decimal" value={terms.rate} onChange={(e) => setTerms({ ...terms, rate: num(e.target.value) })} />
            </Field>
          </div>
          {app.recommendation?.alternatives.length ? (
            <div className="alt-picks">
              <span className="muted">Варианты системы:</span>
              {app.recommendation.alternatives.map((x) => (
                <button key={`${x.terms.amount}-${x.terms.term}`} type="button" className="chip" onClick={() => setTerms({ ...terms, amount: x.terms.amount, term: x.terms.term })}>
                  {rub(x.terms.amount)} · {x.terms.term} мес.
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {variant === 'other_terms' && (
        <div className="form-grid">
          <Field
            label={`Ставка, % (${bounds.min}–${bounds.max})`}
            hint={app.scoring?.grade === 'A' ? 'Группа A — можно снизить ставку на 1 п.п.' : `В заявке ${app.requested.rate}%`}
          >
            <input className="input" inputMode="decimal" value={terms.rate} onChange={(e) => setTerms({ ...terms, rate: num(e.target.value) })} />
          </Field>
        </div>
      )}
      {variant !== 'as_requested' && (
        <>
          <h3 className="form-label">Тип платежа</h3>
          <PaymentTypePicker
            product={product}
            value={terms.paymentType}
            graceMonths={terms.graceMonths}
            name="decision-payment"
            onChange={(paymentType, graceMonths) => setTerms({ ...terms, paymentType, graceMonths })}
          />
        </>
      )}

      {m && (
        <div className="decision-preview">
          <LiveMetric label="DSCR" value={ratio(m.dscr)} zone={dscrZone(m.dscr)} />
          <LiveMetric label="Стресс" value={ratio(m.dscrStress)} zone={stressZone(m.dscrStress)} />
          <LiveMetric label="Долг / CF" value={m.cfNegative ? 'CF ≤ 0' : ratio(m.debtCf)} zone={debtCfZone(m.debtCf)} />
          {schedule &&
            paymentSummary(terms, schedule).map((x) => (
              <span key={x.label}>
                {x.label}: <strong>{rub(x.value)}</strong>
              </span>
            ))}
        </div>
      )}
      {preview && blocked && (
        <div className="notice notice--danger" role="alert">
          <Icon name="xCircle" size={18} />
          <div>
            <strong>{type === 'approve' ? 'Одобрить нельзя' : 'Предложить нельзя'}:</strong>
            <ul className="blockers">
              {preview.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {variant === 'counter' && !invalid && <TermsCompare requested={app.requested} offered={terms} leftLabel="Клиент просил" rightLabel="Предлагаем" />}

      <div className="form-grid">
        <Field label="Код причины">
          <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} · {r.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Предложение действует, дней">
          <input className="input" inputMode="numeric" value={validDays} onChange={(e) => setValidDays(num(e.target.value))} />
        </Field>
      </div>
      <Field
        label="Обоснование (внутреннее, обязательно)"
        error={justification.length > 0 && shortJustification ? `Ещё ${MIN_JUSTIFICATION - justification.trim().length} симв.` : undefined}
      >
        <textarea className="input textarea" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="На чём основано решение: DSCR, документы, обеспечение" />
      </Field>
      <Field label="Сообщение клиенту (необязательно)">
        <textarea className="input textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Например: «Можем выдать 3 млн — так платёж будет комфортнее»" />
      </Field>
      {preview?.secondApproval && !blocked && (
        <div className="notice notice--warm">
          <Icon name="info" size={18} />
          Решение уйдёт на второе подтверждение: {preview.secondApproval}. Статус заявки не изменится, пока другой сотрудник его не подтвердит.
        </div>
      )}
      {(invalid || error) && <p className="form-error">{invalid ?? error}</p>}
      <ModalActions
        onClose={onClose}
        onSubmit={submit}
        pending={pending}
        disabled={!!invalid || blocked || shortJustification}
        label={preview?.secondApproval ? 'Отправить на подтверждение' : type === 'approve' ? 'Одобрить' : 'Отправить предложение'}
      />
    </Modal>
  );
}

/* ---------- Снять мягкий стоп ---------- */

export function WaiveModal({ app, codes, onClose }: { app: Application; codes: string[]; onClose: () => void }) {
  const user = useUser();
  const [code, setCode] = useState(codes[0]);
  const [reasonCode, setReasonCode] = useState(WAIVER_REASONS[0].code);
  const evidenceOptions = [...app.documents.map((d) => `Документ: ${d.name}`), 'Проверка во внешнем источнике', 'Звонок клиенту с фиксацией в истории'];
  const [evidence, setEvidence] = useState(evidenceOptions[0]);
  const [comment, setComment] = useState('');
  const { run, pending, error } = useAction();
  const short = comment.trim().length < MIN_JUSTIFICATION;

  const submit = async () => {
    const ok = await run(() => api.applications.waiveSoftStop(app.id, user.id, { code, reasonCode, evidence, comment }));
    if (ok) onClose();
  };

  return (
    <Modal title="Снять мягкий стоп-фактор" onClose={onClose}>
      <p className="muted form-note">Снятие фиксируется в истории с кодом причины и доказательством. После снятия заявка пересчитывается.</p>
      <fieldset className="reason-list">
        {codes.map((c) => (
          <label key={c} className="radio">
            <input type="radio" name="waive-code" checked={code === c} onChange={() => setCode(c)} />
            <span className="radio__mark" />
            <span>
              <b>{c}</b> · {codeInfo(c).title}
              {app.route?.details[c] ? ` — ${app.route.details[c]}` : ''}
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Код причины">
        <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          {WAIVER_REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} · {r.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Доказательство" hint={codeInfo(code).hint ? `Что проверить: ${codeInfo(code).hint!.toLowerCase()}` : undefined}>
        <select className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)}>
          {evidenceOptions.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <Field label="Обоснование" error={comment.length > 0 && short ? `Ещё ${MIN_JUSTIFICATION - comment.trim().length} симв.` : undefined}>
        <textarea className="input textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Почему риск не мешает решению" />
      </Field>
      {error && <p className="form-error">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} disabled={short} label={`Снять ${code}`} />
    </Modal>
  );
}

/* ---------- Вернуть решение (второе подтверждение) ---------- */

export function ReturnDecisionModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const user = useUser();
  const [comment, setComment] = useState('');
  const { run, pending, error } = useAction();
  const short = comment.trim().length < MIN_JUSTIFICATION;
  const submit = async () => {
    const ok = await run(() => api.applications.returnDecision(app.id, user.id, comment));
    if (ok) onClose();
  };
  return (
    <Modal title="Вернуть решение на доработку" onClose={onClose}>
      <p className="muted form-note">Решение не вступит в силу. {app.pendingDecision?.initiatorName} увидит комментарий в истории заявки.</p>
      <Field label="Комментарий" error={comment.length > 0 && short ? `Ещё ${MIN_JUSTIFICATION - comment.trim().length} симв.` : undefined}>
        <textarea className="input textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что нужно уточнить или изменить" />
      </Field>
      {error && <p className="form-error">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} disabled={short} label="Вернуть" />
    </Modal>
  );
}
