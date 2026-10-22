import { PAYMENT_TYPE_HINT, PAYMENT_TYPE_LABEL } from '../domain/finance';
import type { PaymentType } from '../domain/types';
import type { Product } from '../config/products';

interface Props {
  product: Product;
  value: PaymentType;
  graceMonths?: number;
  onChange: (paymentType: PaymentType, graceMonths?: number) => void;
  name?: string;
}

/** Выбор типа платежа из доступных для продукта — с подсказками простыми словами. */
export default function PaymentTypePicker({ product, value, graceMonths, onChange, name = 'payment-type' }: Props) {
  if (product.paymentTypes.length === 1) {
    return (
      <div className="pay-types pay-types--single">
        <strong>{PAYMENT_TYPE_LABEL[value]}</strong>
        <span>{PAYMENT_TYPE_HINT[value]}</span>
      </div>
    );
  }
  return (
    <div className="pay-types" role="radiogroup" aria-label="Тип платежа">
      {product.paymentTypes.map((t) => (
        <label key={t} className={`pay-type${value === t ? ' is-active' : ''}`}>
          <input type="radio" name={name} checked={value === t} onChange={() => onChange(t, t === 'annuity_grace' ? graceMonths ?? 3 : undefined)} />
          <span className="radio__mark" />
          <span className="pay-type__text">
            <strong>{PAYMENT_TYPE_LABEL[t]}</strong>
            <span>{PAYMENT_TYPE_HINT[t]}</span>
            {t === 'annuity_grace' && value === t && (
              <span className="pay-type__grace" role="group" aria-label="Месяцев отсрочки">
                {Array.from({ length: product.maxGraceMonths ?? 0 }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`preset preset--sm${graceMonths === m ? ' is-active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onChange('annuity_grace', m);
                    }}
                  >
                    {m} мес.
                  </button>
                ))}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
