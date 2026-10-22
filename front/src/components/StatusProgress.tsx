import { Icon } from './Icon';
import { STAGES, stageStates } from '../store/data';
import type { Application } from '../store/types';

const STATE_TEXT = { done: 'пройден', current: 'идёт сейчас', action: 'нужно ваше действие', todo: 'впереди' } as const;

/** Путь клиента: Параметры → Отправка → Проверка → Решение → Выдача. */
export default function StatusProgress({ app, compact = false }: { app: Application; compact?: boolean }) {
  const states = stageStates(app);
  return (
    <ol className={`progress${compact ? ' progress--compact' : ''}`} aria-label="Этапы заявки">
      {STAGES.map((stage, i) => (
        <li key={stage} className={`progress__step is-${states[i]}`} aria-label={`${stage}: ${STATE_TEXT[states[i]]}`}>
          <span className="progress__dot">
            {states[i] === 'done' ? <Icon name="check" size={12} strokeWidth={3} /> : states[i] === 'action' ? '!' : null}
          </span>
          <span className="progress__label">{stage}</span>
        </li>
      ))}
    </ol>
  );
}
