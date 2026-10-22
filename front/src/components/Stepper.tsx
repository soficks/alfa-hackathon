import { Fragment } from 'react';
import { Icon } from './Icon';

interface Props {
  steps: string[];
  current: number;
  onSelect?: (step: number) => void;
}

export default function Stepper({ steps, current, onSelect }: Props) {
  return (
    <ol className="stepper">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n === current ? 'active' : n < current ? 'done' : 'todo';
        return (
          <Fragment key={label}>
            {i > 0 && <li className="stepper__line" aria-hidden="true" />}
            <li className={`stepper__item is-${state}`}>
              <button
                type="button"
                className="stepper__btn"
                disabled={n > current}
                onClick={() => onSelect?.(n)}
                aria-current={n === current ? 'step' : undefined}
              >
                <span className="stepper__num">
                  {state === 'done' ? <Icon name="check" size={20} strokeWidth={2.4} /> : String(n).padStart(2, '0')}
                </span>
                <span className="stepper__label">{label}</span>
              </button>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
