import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import SliderField from '../../components/SliderField';
import Stepper from '../../components/Stepper';
import PaymentTypePicker from '../../components/PaymentType';
import { ScheduleModal } from '../../components/Schedule';
import { CompanyCard } from '../../components/Terms';
import { DocList, UploadButton, demoFile } from '../../components/Docs';
import Field from '../../components/Field';
import { Ribbon } from '../../art/Ribbon';
import { api, type NewDocFile } from '../../api';
import { DOC_TYPES } from '../../config/docTypes';
import { AMOUNT_STEP, STOP_BUSINESS_AGE_MONTHS, amountPoints, amountPresets, goalById, productForGoal, subgoalTitle, termPoints } from '../../config/products';
import { PAYMENT_TYPE_LABEL, calculateSchedule, maxAmountForPayment, minTermForPayment, paymentSummary } from '../../domain/finance';
import { checkInn } from '../../domain/requisites';
import { monthsBetween } from '../../domain/time';
import type { Company, DocType, Financials, Terms, Wizard } from '../../domain/types';
import { useAction, useDb, useUser } from '../../store/data';
import { dateTime, months, percent, rub, shortAmount } from '../../utils/format';

const STEPS = ['Условия', 'Компания', 'Финансы и документы', 'Проверка и согласия'];
const TITLES = ['Настройте кредит под свой бизнес', 'Проверьте компанию', 'Финансы и документы', 'Проверка и согласия'];
const SUBTITLES = [
  'Сумма, срок и тип платежа — платёж пересчитается сразу',
  'Данные подтянуты из ЕГРЮЛ — вводить их не нужно',
  'Обороты возьмём из выписки, кредиты — из кредитной истории',
  'Проверьте данные и дайте согласия — после этого отправим заявку',
];

/** Платёж выше этой доли оборота за 3 мес — мягкое предупреждение */
const SOFT_LIMIT = 0.5;

export default function WizardPage() {
  const user = useUser();
  useDb(); // перерисовка при изменении хранилища
  const navigate = useNavigate();
  const w = api.applications.getWizard(user.id);
  const product = productForGoal(w.goalId);
  const goal = goalById(w.goalId);
  const { run, pending, error, setError } = useAction();

  // Условия держим локально и сохраняем с задержкой — ползунок не пишет в хранилище на каждый кадр
  const [terms, setTerms] = useState<Terms>({ ...w.requested, rate: product.baseRate });
  // смена цели или черновика меняет лимиты продукта — берём условия из сохранённого мастера
  useEffect(() => setTerms({ ...w.requested, rate: product.baseRate }), [w.goalId, w.appId]);
  const saveTimer = useRef<number>();
  const patchTerms = (p: Partial<Terms>) => {
    setTerms((t) => {
      const next = { ...t, ...p };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => api.applications.saveWizard(user.id, { requested: next }), 350);
      return next;
    });
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const schedule = useMemo(() => calculateSchedule(terms), [terms]);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const save = (patch: Partial<Wizard>) => run(() => api.applications.saveWizard(user.id, patch));

  const stepError = (): string | null => {
    if (w.step === 1) {
      if (!w.company) return 'Выберите компанию';
      if (w.company.status !== 'active') return 'Компания ликвидирована — выберите другую';
      if (monthsBetween(new Date(w.company.registeredAt), new Date()) < STOP_BUSINESS_AGE_MONTHS) return `Бизнесу меньше ${STOP_BUSINESS_AGE_MONTHS} месяцев — кредит пока недоступен`;
      if (!w.companyConfirmed) return 'Подтвердите данные компании кнопкой «Всё верно»';
    }
    if (w.step === 2) {
      if (!w.financials) return 'Загрузите выписку по счёту — по ней посчитаем обороты';
      if (!(w.financials.revenue12m > 0)) return 'Укажите выручку за 12 месяцев';
    }
    if (w.step === 3 && !(w.consents.bki && w.consents.personalData && w.consents.authority)) return 'Отметьте все три согласия';
    return null;
  };

  const goStep = async (step: number) => {
    window.clearTimeout(saveTimer.current);
    await save({ step, requested: terms });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = async () => {
    const err = stepError();
    if (err) return setError(err);
    if (w.step < 3) {
      await goStep(w.step + 1);
      await run(() => api.applications.saveDraft(user.id));
      return;
    }
    window.clearTimeout(saveTimer.current);
    await api.applications.saveWizard(user.id, { requested: terms });
    const app = await run(() => api.applications.submit(user.id));
    if (app) navigate(`/applications/${app.id}`);
  };

  return (
    <div className="wizard">
      <Ribbon className="page-ribbon" />
      <h1 className="page-title">{TITLES[w.step]}</h1>
      <p className="page-subtitle">{SUBTITLES[w.step]}</p>

      <Stepper steps={STEPS} current={w.step + 1} onSelect={(s) => goStep(s - 1)} />

      <div className="wizard__grid">
        <section className="card wizard__form">
          {w.step === 0 && (
            <>
              <h3 className="form-label">Цель и продукт</h3>
              <div className="goal-pill">
                <span className="tile-icon">
                  <Icon name="financing" size={22} />
                </span>
                <div className="goal-pill__text">
                  <strong>{goal.title}</strong>
                  <span>
                    {[subgoalTitle(w.goalId, w.subgoalId), product.name].filter(Boolean).join(' · ')} · {product.collateral.note.toLowerCase()}
                  </span>
                </div>
                <Link to="/financing" className="btn btn--outline btn--sm">
                  <Icon name="pencil" size={16} /> Изменить цель
                </Link>
              </div>

              <SliderField
                label="Сумма кредита"
                unit="₽"
                value={terms.amount}
                min={product.minAmount}
                max={product.maxAmount}
                step={AMOUNT_STEP}
                points={amountPoints(product)}
                minorTicks={3}
                onChange={(amount) => patchTerms({ amount })}
                format={rub}
                formatTick={shortAmount}
                formatTip={(v) => `${shortAmount(v)} ₽`}
                ariaLabel="Сумма кредита"
              />
              <div className="presets" role="group" aria-label="Быстрый выбор суммы">
                {amountPresets(product).map((p) => (
                  <button key={p} type="button" className={`preset${terms.amount === p ? ' is-active' : ''}`} onClick={() => patchTerms({ amount: p })}>
                    {shortAmount(p)}
                  </button>
                ))}
              </div>

              <SliderField
                label="Срок кредита"
                unit="мес."
                value={terms.term}
                min={product.minTerm}
                max={product.maxTerm}
                step={1}
                points={termPoints(product)}
                railDots
                onChange={(term) => patchTerms({ term, graceMonths: terms.graceMonths && Math.min(terms.graceMonths, term - 1) })}
                format={months}
                formatTick={String}
                formatTip={months}
                ariaLabel="Срок кредита"
              />

              <h3 className="form-label">Тип платежа</h3>
              <PaymentTypePicker product={product} value={terms.paymentType} graceMonths={terms.graceMonths} onChange={(paymentType, graceMonths) => patchTerms({ paymentType, graceMonths })} />
            </>
          )}

          {w.step === 1 && <CompanyStep w={w} save={save} />}

          {w.step === 2 && <FinanceStep w={w} terms={terms} onTerms={patchTerms} save={save} />}

          {w.step === 3 && <ReviewStep w={w} terms={terms} goStep={goStep} save={save} />}

          <div className="wizard__footer">
            <button type="button" className="btn btn--outline" onClick={() => (w.step === 0 ? navigate('/financing') : goStep(w.step - 1))}>
              <Icon name="arrowLeft" size={18} /> Назад
            </button>
            {w.savedAt && (
              <span className="saved">
                <Icon name="checkCircle" size={18} />
                <span>
                  {w.appId ? `Черновик № ${w.appId} сохранён` : 'Расчёт сохранён'}
                  <small>{dateTime(w.savedAt)}</small>
                </span>
              </span>
            )}
          </div>
        </section>

        <aside className="card estimate">
          <div className="estimate__head">
            <span className="estimate__icon">
              <Icon name="document" size={20} />
            </span>
            <h2>Предварительный расчёт</h2>
          </div>
          <div className={`estimate__main${paymentSummary(terms, schedule).length > 1 ? ' is-pair' : ''}`} aria-live="polite">
            {paymentSummary(terms, schedule).map((x) => (
              <div key={x.label}>
                <span className="estimate__label">{x.label}</span>
                <strong className="estimate__value">{rub(x.value)}</strong>
              </div>
            ))}
          </div>
          <dl className="estimate__rows">
            <div>
              <dt>Сумма кредита</dt>
              <dd>{rub(terms.amount)}</dd>
            </div>
            <div>
              <dt>Срок</dt>
              <dd>{months(terms.term)}</dd>
            </div>
            <div>
              <dt>Ориентировочная ставка</dt>
              <dd>{product.baseRate}% годовых</dd>
            </div>
            <div>
              <dt>Тип платежа</dt>
              <dd>{PAYMENT_TYPE_LABEL[terms.paymentType]}</dd>
            </div>
            <div>
              <dt>Переплата</dt>
              <dd>{rub(schedule.overpayment)}</dd>
            </div>
            <div>
              <dt>Полная сумма выплат</dt>
              <dd>{rub(schedule.total)}</dd>
            </div>
          </dl>
          {product.paymentTypes.includes('annuity') && product.paymentTypes.includes('differentiated') && (
            <p className="estimate__compare">
              Переплата: аннуитет {rub(calculateSchedule({ ...terms, paymentType: 'annuity' }).overpayment)} / дифференцированный{' '}
              {rub(calculateSchedule({ ...terms, paymentType: 'differentiated' }).overpayment)}
            </p>
          )}
          <div className="notice">
            <Icon name="info" size={18} />
            Ориентировочный расчёт без комиссий. Точные условия — после проверки.
          </div>
          <button type="button" className="estimate__schedule" onClick={() => setScheduleOpen(true)}>
            <Icon name="calendar" size={20} />
            <span>График платежей</span>
            <Icon name="chevronRight" size={16} />
          </button>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={next} disabled={pending}>
            {pending ? 'Сохраняем…' : w.step === 3 ? 'Отправить заявку' : 'Продолжить'} <Icon name="arrowRight" size={20} />
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>

      {scheduleOpen && <ScheduleModal terms={terms} onClose={() => setScheduleOpen(false)} />}
    </div>
  );
}

/* ---------- Шаг «Компания» ---------- */

function CompanyStep({ w, save }: { w: Wizard; save: (p: Partial<Wizard>) => Promise<unknown> }) {
  const user = useUser();
  const [other, setOther] = useState(false);
  const [inn, setInn] = useState('');
  const [found, setFound] = useState<Company | null>(null);
  const lookup = useAction();
  const [contact, setContact] = useState(!!w.contactPerson);
  const company = w.company;

  const find = async () => {
    setFound(null);
    const check = checkInn(inn);
    if (!check.ok) return lookup.setError(check.error ?? 'Проверьте ИНН');
    const c = await lookup.run(() => api.registry.lookup(inn));
    if (c) setFound(c);
  };

  const age = found ? monthsBetween(new Date(found.registeredAt), new Date()) : 0;
  const blocked = found && (found.status !== 'active' || age < STOP_BUSINESS_AGE_MONTHS);

  return (
    <>
      {company && <CompanyCard company={company} />}
      <div className="company-confirm">
        {w.companyConfirmed ? (
          <span className="pill pill--ok">
            <Icon name="checkCircle" size={16} /> Данные подтверждены
          </span>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => save({ companyConfirmed: true })} disabled={!company || company.status !== 'active'}>
            <Icon name="check" size={18} /> Всё верно
          </button>
        )}
        <button type="button" className="link-btn" onClick={() => setOther((v) => !v)} aria-expanded={other}>
          Подать от другой компании
        </button>
      </div>

      {other && (
        <div className="other-company">
          <Field label="ИНН компании или ИП" error={lookup.error ?? undefined} hint="10 цифр для компании, 12 — для ИП. Проверим контрольное число и найдём в ЕГРЮЛ.">
            <span className="inline-form">
              <input
                className="input"
                inputMode="numeric"
                maxLength={12}
                value={inn}
                onChange={(e) => {
                  setInn(e.target.value.replace(/\D/g, ''));
                  lookup.setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), find())}
                placeholder="Например, 7701111110"
              />
              <button type="button" className="btn btn--outline" onClick={find} disabled={lookup.pending || inn.length < 10}>
                {lookup.pending ? 'Ищем в ЕГРЮЛ…' : 'Найти'}
              </button>
            </span>
          </Field>
          {found && (
            <>
              <CompanyCard company={found} />
              {blocked ? (
                <div className="notice notice--danger">
                  <Icon name="xCircle" size={18} />
                  {found.status !== 'active'
                    ? 'Эта компания ликвидирована — подать заявку от неё нельзя.'
                    : `Компания зарегистрирована меньше ${STOP_BUSINESS_AGE_MONTHS} месяцев назад — кредит станет доступен позже.`}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={async () => {
                    // другая компания — другие обороты и кредиты: финансы собираем заново
                    await save({ company: found, companyConfirmed: true, financials: null, documents: [] });
                    setOther(false);
                    setFound(null);
                    setInn('');
                  }}
                >
                  Подать от этой компании
                </button>
              )}
            </>
          )}
        </div>
      )}

      <h3 className="form-label">Контакты для связи</h3>
      <p className="muted form-note">Берём из вашего профиля — специалист напишет в сообщениях по заявке.</p>
      <dl className="kv kv--compact">
        <dt>Заявитель</dt>
        <dd>
          {user.firstName} {user.lastName}, {user.position.toLowerCase()}
        </dd>
        <dt>Телефон</dt>
        <dd>{user.phone}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
      </dl>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={contact}
          onChange={(e) => {
            setContact(e.target.checked);
            if (!e.target.checked) save({ contactPerson: undefined });
          }}
        />
        <span className="checkbox__mark">
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        Другое контактное лицо по заявке
      </label>
      {contact && (
        <div className="form-grid">
          <Field label="Имя и фамилия">
            <input className="input" defaultValue={w.contactPerson?.name ?? ''} onBlur={(e) => save({ contactPerson: { name: e.target.value, phone: w.contactPerson?.phone ?? '' } })} />
          </Field>
          <Field label="Телефон">
            <input className="input" type="tel" defaultValue={w.contactPerson?.phone ?? ''} onBlur={(e) => save({ contactPerson: { name: w.contactPerson?.name ?? '', phone: e.target.value } })} />
          </Field>
        </div>
      )}
    </>
  );
}

/* ---------- Шаг «Финансы и документы» ---------- */

function FinanceStep({ w, terms, onTerms, save }: { w: Wizard; terms: Terms; onTerms: (p: Partial<Terms>) => void; save: (p: Partial<Wizard>) => Promise<unknown> }) {
  const product = productForGoal(w.goalId);
  const analysis = useAction();
  const f = w.financials;
  const inn = w.company?.inn;

  const addStatement = async (files: NewDocFile[]) => {
    if (!inn) return;
    const financials = await analysis.run(() => api.statement.prefill(inn));
    if (financials) await save({ financials, documents: [...w.documents.filter((d) => d.docType !== 'bank_statement'), ...files.map(asWizardDoc)] });
  };

  const addDocs = (files: NewDocFile[]) => save({ documents: [...w.documents, ...files.map(asWizardDoc)] });
  const removeDoc = (id: string) => save({ documents: w.documents.filter((d) => d.id !== id) });
  const setFin = (p: Partial<Financials>) => f && save({ financials: { ...f, ...p } });

  const otherSlots = product.requiredDocs.filter((t) => t !== 'bank_statement');
  const extras = w.documents.filter((d) => !product.requiredDocs.includes(d.docType));

  // мягкая пред-проверка: платёж против оборота за 3 месяца
  const maxPayment = calculateSchedule(terms).maxPayment;
  const share = f && f.avgTurnover3m > 0 ? maxPayment / f.avgTurnover3m : 0;
  const limit = f ? f.avgTurnover3m * SOFT_LIMIT : 0;
  const longerTerm = f && share > SOFT_LIMIT ? minTermForPayment(limit, terms, terms.term + 1, product.maxTerm) : null;
  const smallerAmount = f && share > SOFT_LIMIT ? Math.max(product.minAmount, maxAmountForPayment(limit, terms, AMOUNT_STEP)) : null;

  return (
    <>
      <h3 className="form-label">Выписка по расчётному счёту за 12 месяцев</h3>
      <p className="muted form-note">{DOC_TYPES.bank_statement.why}</p>
      <div className="slot">
        {w.documents.filter((d) => d.docType === 'bank_statement').length > 0 ? (
          <DocList docs={w.documents.filter((d) => d.docType === 'bank_statement')} onRemove={removeDoc} />
        ) : (
          <div className="slot__actions">
            <UploadButton docType="bank_statement" onFiles={addStatement} label="Загрузить выписку" variant="primary" disabled={analysis.pending} />
            <button type="button" className="btn btn--outline btn--sm" onClick={() => addStatement([demoFile('bank_statement', 'Выписка за 12 месяцев (демо).pdf')])} disabled={analysis.pending}>
              Использовать демо-выписку
            </button>
          </div>
        )}
        {analysis.pending && <p className="loading-line">Анализируем выписку и запрашиваем кредитную историю…</p>}
        {analysis.error && <p className="form-error">{analysis.error}</p>}
      </div>

      {f && (
        <>
          <div className="fin-grid">
            <Field label="Выручка за 12 месяцев, ₽" hint="Посчитали по выписке — поправьте, если нужно">
              <input className="input" inputMode="numeric" value={f.revenue12m || ''} onChange={(e) => setFin({ revenue12m: Number(e.target.value.replace(/\D/g, '')) })} />
            </Field>
            <div className="fin-stat">
              <span>Средний оборот в месяц за 12 мес.</span>
              <strong>{rub(f.avgTurnover12m)}</strong>
            </div>
            <div className="fin-stat">
              <span>Средний оборот за 3 мес.</span>
              <strong>
                {rub(f.avgTurnover3m)}{' '}
                <em className={f.avgTurnover3m >= f.avgTurnover12m ? 'up' : 'down'}>
                  {f.avgTurnover3m >= f.avgTurnover12m ? '+' : '−'}
                  {percent(Math.abs(f.avgTurnover3m / f.avgTurnover12m - 1))}
                </em>
              </strong>
            </div>
          </div>

          <h3 className="form-label">Действующие кредиты и лизинг</h3>
          <p className="muted form-note">
            <Icon name="shield" size={14} /> По данным кредитной истории (демо): кредитов — {f.existingLoans}. Если что-то изменилось, уточните.
          </p>
          <div className="form-grid">
            <Field label="Общий долг, ₽">
              <input className="input" inputMode="numeric" value={f.existingDebt} onChange={(e) => setFin({ existingDebt: Number(e.target.value.replace(/\D/g, '')) })} />
            </Field>
            <Field label="Платежи по ним в месяц, ₽">
              <input className="input" inputMode="numeric" value={f.existingMonthlyPayments} onChange={(e) => setFin({ existingMonthlyPayments: Number(e.target.value.replace(/\D/g, '')) })} />
            </Field>
          </div>

          {share > SOFT_LIMIT && (
            <div className="notice notice--warm precheck" role="status">
              <Icon name="warning" size={18} />
              <div>
                <strong>Платёж может оказаться высоким для текущих оборотов</strong>
                <p>
                  Максимальный платёж {rub(maxPayment)} — это {percent(share)} среднего оборота за 3 месяца. Заявку можно отправить, но с меньшим платежом её проще одобрить.
                </p>
                <div className="precheck__actions">
                  {longerTerm && (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => onTerms({ term: longerTerm })}>
                      Увеличить срок до {months(longerTerm)}
                    </button>
                  )}
                  {smallerAmount && smallerAmount < terms.amount && (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => onTerms({ amount: smallerAmount })}>
                      Уменьшить сумму до {rub(smallerAmount)}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <h3 className="form-label">Документы для продукта «{product.name}»</h3>
      {otherSlots.map((t) => (
        <DocSlot key={t} type={t} docs={w.documents.filter((d) => d.docType === t)} onAdd={addDocs} onRemove={removeDoc} />
      ))}
      <div className="slot">
        <div className="slot__head">
          <div>
            <strong>Другой документ</strong>
            <span>{DOC_TYPES.other.why}</span>
          </div>
          <UploadButton docType="other" onFiles={addDocs} label="Добавить" />
        </div>
        {extras.length > 0 && <DocList docs={extras} onRemove={removeDoc} />}
      </div>
      <button
        type="button"
        className="btn btn--outline btn--sm demo-fill"
        disabled={!inn || analysis.pending}
        onClick={async () => {
          const missing = product.requiredDocs.filter((t) => !w.documents.some((d) => d.docType === t));
          const files = missing.filter((t) => t !== 'bank_statement').map((t) => demoFile(t));
          if (missing.includes('bank_statement') && inn) {
            const financials = await analysis.run(() => api.statement.prefill(inn));
            await save({ financials: financials ?? w.financials, documents: [...w.documents, demoFile('bank_statement', 'Выписка за 12 месяцев (демо).pdf'), ...files].map(asWizardDoc) });
          } else {
            await addDocs(files);
          }
        }}
      >
        <Icon name="sparkle" size={16} /> Заполнить все документы (демо)
      </button>
    </>
  );
}

const asWizardDoc = (d: NewDocFile | Wizard['documents'][number]): Wizard['documents'][number] =>
  'source' in d ? d : { ...d, addedBy: 'client', source: 'submission' };

function DocSlot({ type, docs, onAdd, onRemove }: { type: DocType; docs: Wizard['documents']; onAdd: (f: NewDocFile[]) => void; onRemove: (id: string) => void }) {
  return (
    <div className={`slot${docs.length ? ' slot--done' : ''}`}>
      <div className="slot__head">
        <div>
          <strong>
            {docs.length > 0 && <Icon name="checkCircle" size={16} className="slot__ok" />} {DOC_TYPES[type].title}
          </strong>
          <span>{DOC_TYPES[type].why}</span>
        </div>
        <UploadButton docType={type} onFiles={onAdd} label={docs.length ? 'Ещё файл' : 'Загрузить'} />
      </div>
      {docs.length > 0 && <DocList docs={docs} onRemove={onRemove} />}
    </div>
  );
}

/* ---------- Шаг «Проверка и согласия» ---------- */

function ReviewStep({ w, terms, goStep, save }: { w: Wizard; terms: Terms; goStep: (s: number) => void; save: (p: Partial<Wizard>) => Promise<unknown> }) {
  const user = useUser();
  const product = productForGoal(w.goalId);
  const goal = goalById(w.goalId);
  const missing = product.requiredDocs.filter((t) => !w.documents.some((d) => d.docType === t));
  const summary = paymentSummary(terms);
  const f = w.financials;

  const consent = (key: keyof Wizard['consents'], label: string) => (
    <label className="checkbox">
      <input type="checkbox" checked={!!w.consents[key]} onChange={(e) => save({ consents: { ...w.consents, [key]: e.target.checked } })} />
      <span className="checkbox__mark">
        <Icon name="check" size={14} strokeWidth={3} />
      </span>
      {label}
    </label>
  );

  const section = (title: string, step: number, rows: [string, string][]) => (
    <div className="review">
      <div className="review__head">
        <h3>{title}</h3>
        <button type="button" className="link-btn" onClick={() => goStep(step)}>
          Изменить
        </button>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <>
      {section('Условия', 0, [
        ['Цель', [goal.title, subgoalTitle(w.goalId, w.subgoalId)].filter(Boolean).join(' — ')],
        ['Продукт', product.name],
        ['Сумма и срок', `${rub(terms.amount)} · ${months(terms.term)}`],
        ['Тип платежа', `${PAYMENT_TYPE_LABEL[terms.paymentType]}${terms.graceMonths ? `, отсрочка ${terms.graceMonths} мес.` : ''}`],
        ['Платёж', summary.map((x) => `${x.label.toLowerCase()} ${rub(x.value)}`).join(', ')],
        ['Ставка', `ориентировочно ${product.baseRate}% годовых`],
      ])}
      {w.company &&
        section('Компания', 1, [
          ['Компания', w.company.name],
          ['ИНН', w.company.inn],
          ['Контакт', w.contactPerson?.name ? `${w.contactPerson.name}, ${w.contactPerson.phone}` : `${user.firstName} ${user.lastName}, ${user.phone}`],
        ])}
      {f &&
        section('Финансы и документы', 2, [
          ['Выручка за 12 мес.', rub(f.revenue12m)],
          ['Средний оборот за 3 мес.', rub(f.avgTurnover3m)],
          ['Действующие кредиты', `${rub(f.existingDebt)}, платежи ${rub(f.existingMonthlyPayments)} в месяц`],
          ['Документы', w.documents.map((d) => DOC_TYPES[d.docType].short).join(', ') || 'нет'],
        ])}
      {missing.length > 0 && (
        <div className="notice notice--warm">
          <Icon name="info" size={18} />
          Не хватает: {missing.map((t) => DOC_TYPES[t].title.toLowerCase()).join(', ')}. Заявку можно отправить — специалист попросит документ, но проверка займёт больше времени.
        </div>
      )}

      <h3 className="form-label">Согласия</h3>
      <div className="consents">
        {consent('bki', 'Согласен(на) на запрос в бюро кредитных историй — чтобы банк увидел действующие кредиты компании')}
        {consent('personalData', 'Согласен(на) на обработку персональных данных')}
        {consent('authority', `Я уполномочен(а) подавать заявку от имени компании: ${user.position.toLowerCase()}${user.authority ? `, ${user.authority.toLowerCase()}` : ''}`)}
        {/* ИП — физлицо: без согласия на автоматизированное решение заявку смотрит специалист (код G08) */}
        {w.company?.form === 'ИП' &&
          consent('automated', 'Согласен(на) на автоматизированное решение по заявке. Необязательно: без согласия решение примет специалист, это займёт больше времени')}
      </div>
    </>
  );
}
