import { Icon } from './Icon';
import { CLIENT_STAGES, clientStageStates } from '../domain/statusText';
import type { AppStatus } from '../domain/types';

const STATE_TEXT = { done: 'пройден', current: 'идёт сейчас', action: 'нужно ваше действие', todo: 'впереди', fail: 'завершён без выдачи' } as const;

/** Путь клиента: Параметры → Проверка → Решение → Подписание → Выдача. */
export default function StageProgress({ status, compact = false }: { status: AppStatus; compact?: boolean }) {
  const states = clientStageStates(status);
  return (
    <ol className={`progress${compact ? ' progress--compact' : ''}`} aria-label="Этапы заявки">
      {CLIENT_STAGES.map((stage, i) => (
        <li key={stage} className={`progress__step is-${states[i]}`} aria-label={`${stage}: ${STATE_TEXT[states[i]]}`}>
          <span className="progress__dot">
            {states[i] === 'done' ? (
              <Icon name="check" size={12} strokeWidth={3} />
            ) : states[i] === 'action' ? (
              '!'
            ) : states[i] === 'fail' ? (
              <Icon name="close" size={11} strokeWidth={3} />
            ) : null}
          </span>
          <span className="progress__label">{stage}</span>
        </li>
      ))}
    </ol>
  );
}
