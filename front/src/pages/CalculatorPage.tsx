import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Field from '../components/Field';
import { Icon } from '../components/Icon';
import Modal from '../components/Modal';
import Schedule from '../components/Schedule';
import SliderField from '../components/SliderField';
import Stepper from '../components/Stepper';
import UploadBox from '../components/UploadBox';
import { Ribbon } from '../art/Ribbon';
import { DEMO_COMPANY, TAX_SYSTEMS, goalById } from '../store/data';
import { nextAppId, useStore } from '../store/store';
import type { Company, Wizard } from '../store/types';
import {
  AMOUNT_MAX,
  AMOUNT_MIN,
  AMOUNT_POINTS,
  AMOUNT_PRESETS,
  AMOUNT_STEP,
  DEMO_RATE,
  TERM_MAX,
  TERM_MIN,
  TERM_POINTS,
  TERM_STEP,
  calculateLoan,
  validateCompany,
} from '../utils/finance';
import { dateTime, months, rub, shortAmount } from '../utils/format';

const STEPS = ['Условия', 'Компания', 'Данные', 'Проверка'];
const TITLES = ['Настройте кредит под свой бизнес', 'Расскажите о компании', 'Добавьте финансовые данные', 'Проверьте заявку'];
const SUBTITLES = [
  'Укажите параметры — мы сразу пересчитаем платёж',
  'Реквизиты и контакты для заявки',
  'Прикрепите выписку и укажите выручку',
  'Убедитесь, что всё верно, перед отправкой',
];

type Errors = Partial<Record<string, string>>;

export default function CalculatorPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { wizard: w } = state;
  const goal = goalById(w.goal);
  const loan = calculateLoan(w.amount, w.term);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const patch = (p: Partial<Wizard>) => dispatch({ type: 'wizard/patch', patch: p });
  const setCompany = (key: keyof Company, value: string) => {
    patch({ company: { ...w.company, [key]: value } });
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const goStep = (step: number) => {
    setErrors({});
    patch({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validateStep = (): Errors => {
    if (w.step === 1) return validateCompany(w.company);
    if (w.step === 2) {
      const e: Errors = {};
      if (!(Number(w.revenue) > 0)) e.revenue = 'Укажите годовую выручку больше нуля';
      if (!w.documents.length) e.documents = 'Добавьте выписку или используйте демо-выписку';
      return e;
    }
    if (w.step === 3 && !consent) return { consent: 'Подтвердите отправку заявки' };
    return {};
  };

  const next = () => {
    const e = validateStep();
    setErrors(e);
    if (Object.keys(e).length) return;
    if (w.step < 3) {
      dispatch({ type: 'wizard/saveDraft' });
      goStep(w.step + 1);
      return;
    }
    // Перед отправкой ещё раз проверяем всё, что могли изменить на ранних шагах
    if (Object.keys(validateCompany(w.company)).length) return goStep(1);
    if (!(Number(w.revenue) > 0) || !w.documents.length) return goStep(2);
    const id = w.appId ?? nextAppId(state.applications);
    dispatch({ type: 'wizard/submit', id });
    setConsent(false);
    navigate(`/applications/${id}`, { state: { toast: 'Заявка отправлена — через пару секунд она уйдёт специалисту' } });
  };

  const back = () => (w.step === 0 ? navigate('/financing') : goStep(w.step - 1));

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
              <h3 className="form-label">Цель финансирования</h3>
              <div className="goal-pill">
                <span className="tile-icon">
                  <Icon name="financing" size={22} />
                </span>
                <div className="goal-pill__text">
                  <strong>{goal.title}</strong>
                  <span>{goal.options[w.option]}</span>
                </div>
                <Link to="/financing" className="btn btn--outline btn--sm">
                  <Icon name="pencil" size={16} /> Изменить цель
                </Link>
              </div>

              <SliderField
                label="Сумма кредита"
                unit="₽"
                value={w.amount}
                min={AMOUNT_MIN}
                max={AMOUNT_MAX}
                step={AMOUNT_STEP}
                points={AMOUNT_POINTS}
                minorTicks={4}
                onChange={(amount) => patch({ amount })}
                format={rub}
                formatTick={shortAmount}
                formatTip={(v) => `${shortAmount(v)} ₽`}
                ariaLabel="Сумма кредита"
              />
              <div className="presets" role="group" aria-label="Быстрый выбор суммы">
                {AMOUNT_PRESETS.map((p) => (
                  <button key={p} type="button" className={`preset${w.amount === p ? ' is-active' : ''}`} onClick={() => patch({ amount: p })}>
                    {shortAmount(p)}
                  </button>
                ))}
              </div>

              <SliderField
                label="Срок кредита"
                unit="мес."
                value={w.term}
                min={TERM_MIN}
                max={TERM_MAX}
                step={TERM_STEP}
                points={TERM_POINTS}
                railDots
                onChange={(term) => patch({ term })}
                format={months}
                formatTick={String}
                formatTip={months}
                ariaLabel="Срок кредита"
              />
            </>
          )}

          {w.step === 1 && (
            <>
              <div className="form-heading">
                <h2 className="card-title">Сведения о компании</h2>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => {
                    patch({ company: { ...DEMO_COMPANY } });
                    setErrors({});
                  }}
                >
                  Заполнить из профиля
                </button>
              </div>
              <p className="muted form-note">Используйте вымышленные данные: автопоиск по реестрам пока не подключён.</p>
              <div className="segmented" role="radiogroup" aria-label="Форма бизнеса">
                {(['ООО', 'ИП'] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={w.company.type === t} className={w.company.type === t ? 'is-active' : ''} onClick={() => setCompany('type', t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <Field label="Название компании или ИП" error={errors.name} wide>
                  <input className="input" value={w.company.name} onChange={(e) => setCompany('name', e.target.value)} placeholder="ООО «Название»" />
                </Field>
                <Field label="ИНН" error={errors.inn}>
                  <input
                    className="input"
                    inputMode="numeric"
                    maxLength={w.company.type === 'ООО' ? 10 : 12}
                    value={w.company.inn}
                    onChange={(e) => setCompany('inn', e.target.value.replace(/\D/g, ''))}
                    placeholder={w.company.type === 'ООО' ? '10 цифр' : '12 цифр'}
                  />
                </Field>
                <Field label={w.company.type === 'ООО' ? 'ОГРН' : 'ОГРНИП'} error={errors.ogrn}>
                  <input
                    className="input"
                    inputMode="numeric"
                    maxLength={w.company.type === 'ООО' ? 13 : 15}
                    value={w.company.ogrn}
                    onChange={(e) => setCompany('ogrn', e.target.value.replace(/\D/g, ''))}
                    placeholder={w.company.type === 'ООО' ? '13 цифр' : '15 цифр'}
                  />
                </Field>
                <Field label="Юридический адрес" error={errors.address} wide>
                  <input className="input" value={w.company.address} onChange={(e) => setCompany('address', e.target.value)} />
                </Field>
                <Field label="Контактное лицо" error={errors.contact}>
                  <input className="input" value={w.company.contact} onChange={(e) => setCompany('contact', e.target.value)} />
                </Field>
                <Field label="Телефон" error={errors.phone}>
                  <input className="input" type="tel" value={w.company.phone} onChange={(e) => setCompany('phone', e.target.value)} placeholder="+7 999 000-00-00" />
                </Field>
                <Field label="Email" error={errors.email}>
                  <input className="input" type="email" value={w.company.email} onChange={(e) => setCompany('email', e.target.value)} placeholder="demo@example.com" />
                </Field>
              </div>
            </>
          )}

          {w.step === 2 && (
            <>
              <h2 className="card-title">Финансы и документы</h2>
              <div className="form-grid">
                <Field label="Выручка за последние 12 месяцев, ₽" error={errors.revenue}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={w.revenue}
                    onChange={(e) => {
                      patch({ revenue: e.target.value.replace(/\D/g, '') });
                      setErrors((x) => ({ ...x, revenue: undefined }));
                    }}
                    placeholder="Например, 12000000"
                  />
                </Field>
                <Field label="Система налогообложения">
                  <select className="input" value={w.tax} onChange={(e) => patch({ tax: e.target.value })}>
                    {TAX_SYSTEMS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <h3 className="form-label">Выписка и отчётность</h3>
              <p className="muted form-note">Выписка по расчётному счёту за 6 месяцев. Файлы остаются на вашем устройстве.</p>
              <UploadBox
                documents={w.documents}
                onChange={(documents) => {
                  patch({ documents });
                  setErrors((x) => ({ ...x, documents: undefined }));
                }}
              />
              {errors.documents && (
                <p className="form-error" role="alert">
                  {errors.documents}
                </p>
              )}
              <button
                type="button"
                className="btn btn--outline btn--sm demo-fill"
                onClick={() => {
                  patch({
                    documents: [...w.documents, { id: crypto.randomUUID(), name: 'Демо-выписка за 6 месяцев.pdf', size: 248_000, addedAt: new Date().toISOString(), demo: true }],
                    revenue: w.revenue || '12000000',
                  });
                  setErrors({});
                }}
              >
                Использовать демо-выписку
              </button>
            </>
          )}

          {w.step === 3 && (
            <>
              <h2 className="card-title">Всё готово к отправке</h2>
              <div className="review">
                <div className="review__head">
                  <h3>Ваш запрос</h3>
                  <button type="button" className="link-btn" onClick={() => goStep(0)}>
                    Изменить
                  </button>
                </div>
                <dl className="kv">
                  <dt>Цель</dt>
                  <dd>
                    {goal.title} — {goal.options[w.option].toLowerCase()}
                  </dd>
                  <dt>Сумма и срок</dt>
                  <dd>
                    {rub(w.amount)} · {months(w.term)}
                  </dd>
                  <dt>Платёж</dt>
                  <dd>
                    {rub(loan.payment)} в месяц · {DEMO_RATE}% годовых
                  </dd>
                </dl>
              </div>
              <div className="review">
                <div className="review__head">
                  <h3>{w.company.name}</h3>
                  <button type="button" className="link-btn" onClick={() => goStep(1)}>
                    Изменить
                  </button>
                </div>
                <dl className="kv">
                  <dt>ИНН</dt>
                  <dd>{w.company.inn}</dd>
                  <dt>{w.company.type === 'ООО' ? 'ОГРН' : 'ОГРНИП'}</dt>
                  <dd>{w.company.ogrn}</dd>
                  <dt>Адрес</dt>
                  <dd>{w.company.address}</dd>
                  <dt>Контакт</dt>
                  <dd>
                    {w.company.contact}, {w.company.phone}, {w.company.email}
                  </dd>
                </dl>
              </div>
              <div className="review">
                <div className="review__head">
                  <h3>Финансы и документы</h3>
                  <button type="button" className="link-btn" onClick={() => goStep(2)}>
                    Изменить
                  </button>
                </div>
                <dl className="kv">
                  <dt>Выручка за год</dt>
                  <dd>
                    {rub(Number(w.revenue))} · {w.tax}
                  </dd>
                  <dt>Документы</dt>
                  <dd>{w.documents.map((d) => d.name).join(', ')}</dd>
                </dl>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    setErrors({});
                  }}
                />
                <span className="checkbox__mark">
                  <Icon name="check" size={14} strokeWidth={3} />
                </span>
                Подтверждаю отправку демо-заявки. Понимаю, что данные не передаются в банк.
              </label>
              {errors.consent && (
                <p className="form-error" role="alert">
                  {errors.consent}
                </p>
              )}
            </>
          )}

          <div className="wizard__footer">
            <button type="button" className="btn btn--outline" onClick={back}>
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
          <span className="estimate__label">Ежемесячный платёж</span>
          <strong className="estimate__value" aria-live="polite">
            {rub(loan.payment)}
          </strong>
          <dl className="estimate__rows">
            <div>
              <dt>Сумма кредита</dt>
              <dd>{rub(w.amount)}</dd>
            </div>
            <div>
              <dt>Срок</dt>
              <dd>{months(w.term)}</dd>
            </div>
            <div>
              <dt>Ставка</dt>
              <dd>{DEMO_RATE}% годовых</dd>
            </div>
            <div>
              <dt>Переплата</dt>
              <dd>{rub(loan.overpayment)}</dd>
            </div>
            <div>
              <dt>Полная сумма выплат</dt>
              <dd>{rub(loan.total)}</dd>
            </div>
          </dl>
          <div className="notice">
            <Icon name="info" size={18} />
            Демо-расчёт без комиссий и страховки. Итоговые условия — после проверки данных.
          </div>
          <button type="button" className="estimate__schedule" onClick={() => setScheduleOpen(true)}>
            <Icon name="calendar" size={20} />
            <span>Посмотреть график платежей</span>
            <Icon name="chevronRight" size={16} />
          </button>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={next}>
            {w.step === 3 ? 'Отправить заявку' : 'Продолжить'} <Icon name="arrowRight" size={20} />
          </button>
        </aside>
      </div>

      {scheduleOpen && (
        <Modal title="График платежей" onClose={() => setScheduleOpen(false)}>
          <p className="muted">
            {rub(w.amount)} · {months(w.term)} · {DEMO_RATE}% годовых, демо
          </p>
          <Schedule calculation={loan} />
        </Modal>
      )}
    </div>
  );
}
