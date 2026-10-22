import type { LoanCalculation } from '../utils/finance';
import { rubCents } from '../utils/format';

export default function Schedule({ calculation }: { calculation: LoanCalculation }) {
  return (
    <>
      <div className="schedule-totals">
        <span>
          Всего выплат <strong>{rubCents(calculation.total)}</strong>
        </span>
        <span>
          Переплата <strong>{rubCents(calculation.overpayment)}</strong>
        </span>
      </div>
      <div className="table-wrap">
        <table className="schedule">
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Платёж</th>
              <th>Основной долг</th>
              <th>Проценты</th>
              <th>Остаток</th>
            </tr>
          </thead>
          <tbody>
            {calculation.schedule.map((row) => (
              <tr key={row.month}>
                <td>{row.month}</td>
                <td>{rubCents(row.payment)}</td>
                <td>{rubCents(row.principal)}</td>
                <td>{rubCents(row.interest)}</td>
                <td>{rubCents(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">Аннуитетные платежи по условной ставке, без комиссий. Последний платёж скорректирован для полного погашения.</p>
    </>
  );
}
