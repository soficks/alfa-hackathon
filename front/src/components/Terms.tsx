import { Icon } from './Icon';
import { PAYMENT_TYPE_LABEL, calculateSchedule, paymentSummary } from '../domain/finance';
import { monthsBetween } from '../domain/time';
import type { Company, Terms } from '../domain/types';
import { MIN_BUSINESS_AGE_MONTHS } from '../config/products';
import { businessAge, fullDate, months, rub } from '../utils/format';

const typeText = (t: Terms) => `${PAYMENT_TYPE_LABEL[t.paymentType]}${t.paymentType === 'annuity_grace' && t.graceMonths ? `, ${t.graceMonths} мес.` : ''}`;

/** Сумма, срок, ставка, тип и платёж — строкой метрик. */
export function TermsMetrics({ terms, rateLabel = 'Ставка' }: { terms: Terms; rateLabel?: string }) {
  const summary = paymentSummary(terms);
  const s = calculateSchedule(terms);
  return (
    <dl className="conditions">
      <div>
        <dt>Сумма</dt>
        <dd>{rub(terms.amount)}</dd>
      </div>
      <div>
        <dt>Срок</dt>
        <dd>{months(terms.term)}</dd>
      </div>
      <div>
        <dt>{rateLabel}</dt>
        <dd>{terms.rate}%</dd>
      </div>
      <div>
        <dt>Тип платежа</dt>
        <dd className="conditions__text">{typeText(terms)}</dd>
      </div>
      {summary.map((x) => (
        <div key={x.label}>
          <dt>{x.label}</dt>
          <dd>{rub(x.value)}</dd>
        </div>
      ))}
      <div>
        <dt>Переплата</dt>
        <dd>{rub(s.overpayment)}</dd>
      </div>
    </dl>
  );
}

/** «Вы просили / Банк предлагает» */
export function TermsCompare({ requested, offered, leftLabel = 'Вы просили', rightLabel = 'Банк предлагает' }: { requested: Terms; offered: Terms; leftLabel?: string; rightLabel?: string }) {
  const a = calculateSchedule(requested);
  const b = calculateSchedule(offered);
  const rows: [string, string, string][] = [
    ['Сумма', rub(requested.amount), rub(offered.amount)],
    ['Срок', months(requested.term), months(offered.term)],
    ['Ставка', `${requested.rate}%`, `${offered.rate}%`],
    ['Тип платежа', typeText(requested), typeText(offered)],
    ['Платёж (максимальный)', rub(a.maxPayment), rub(b.maxPayment)],
    ['Переплата', rub(a.overpayment), rub(b.overpayment)],
  ];
  return (
    <table className="compare">
      <thead>
        <tr>
          <th />
          <th>{leftLabel}</th>
          <th>{rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, x, y]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{x}</td>
            <td className={x !== y ? 'is-changed' : ''}>{y}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Карточка компании из реестра (только чтение). */
export function CompanyCard({ company, note = 'Данные из ЕГРЮЛ (демо)', now = new Date() }: { company: Company; note?: string; now?: Date }) {
  const age = monthsBetween(new Date(company.registeredAt), now);
  return (
    <div className="company-card-reg">
      <div className="company-card-reg__head">
        <span className="tile-icon">
          <Icon name="building" size={22} />
        </span>
        <div>
          <strong>{company.name}</strong>
          <span className="registry-pill">
            <Icon name="shield" size={14} /> {note}
          </span>
        </div>
      </div>
      <dl className="requisites requisites--grid">
        <div>
          <dt>Форма</dt>
          <dd>{company.form === 'ИП' ? 'Индивидуальный предприниматель' : 'Общество с ограниченной ответственностью'}</dd>
        </div>
        <div>
          <dt>ИНН</dt>
          <dd>{company.inn}</dd>
        </div>
        <div>
          <dt>{company.form === 'ИП' ? 'ОГРНИП' : 'ОГРН'}</dt>
          <dd>{company.ogrn}</dd>
        </div>
        <div>
          <dt>Адрес</dt>
          <dd>{company.address}</dd>
        </div>
        <div>
          <dt>{company.form === 'ИП' ? 'Предприниматель' : 'Руководитель'}</dt>
          <dd>{company.head}</dd>
        </div>
        <div>
          <dt>Зарегистрирована</dt>
          <dd>
            {fullDate(company.registeredAt)} · {businessAge(age)}
          </dd>
        </div>
        <div className="requisites__wide">
          <dt>Основной ОКВЭД</dt>
          <dd>
            {company.okved} — {company.okvedName}
          </dd>
        </div>
      </dl>
      {company.status === 'liquidated' && (
        <div className="notice notice--danger">
          <Icon name="xCircle" size={18} />
          Компания ликвидирована по данным ЕГРЮЛ — оформить кредит на неё нельзя.
        </div>
      )}
      {company.status === 'active' && age < MIN_BUSINESS_AGE_MONTHS && (
        <div className="notice notice--warm">
          <Icon name="warning" size={18} />
          Бизнес работает меньше {MIN_BUSINESS_AGE_MONTHS} месяцев. Заявку можно подать, но её внимательнее проверит специалист.
        </div>
      )}
    </div>
  );
}
