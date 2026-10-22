import Modal from './Modal';
import { PAYMENT_TYPE_LABEL, SCHEDULE_NOTE, calculateSchedule, type ScheduleInput } from '../domain/finance';
import { money, months, rub } from '../utils/format';

export function ScheduleTable({ terms }: { terms: ScheduleInput }) {
  const s = calculateSchedule(terms);
  return (
    <>
      <div className="schedule-totals">
        <div>
          <span>Всего выплат</span>
          <strong>{rub(s.total)}</strong>
        </div>
        <div>
          <span>Переплата</span>
          <strong>{rub(s.overpayment)}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table className="schedule">
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Платёж, ₽</th>
              <th>Основной долг, ₽</th>
              <th>Проценты, ₽</th>
              <th>Остаток, ₽</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                <td>{money(r.payment)}</td>
                <td>{money(r.principal)}</td>
                <td>{money(r.interest)}</td>
                <td>{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">
        {SCHEDULE_NOTE[terms.paymentType]} Месячная ставка = годовая / 12, без комиссий и страховки. Ориентировочный расчёт — точные условия после проверки.
      </p>
    </>
  );
}

export function ScheduleModal({ terms, onClose, title = 'График платежей' }: { terms: ScheduleInput; onClose: () => void; title?: string }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">
        {rub(terms.amount)} · {months(terms.term)} · {terms.rate}% годовых · {PAYMENT_TYPE_LABEL[terms.paymentType].toLowerCase()}
        {terms.paymentType === 'annuity_grace' && terms.graceMonths ? `, отсрочка ${terms.graceMonths} мес.` : ''}
      </p>
      <ScheduleTable terms={terms} />
    </Modal>
  );
}
