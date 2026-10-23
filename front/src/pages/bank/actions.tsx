import { useMemo, type ReactNode } from 'react';
import { api } from '../../api';
import { codeInfo } from '../../config/routeCodes';
import { isFinal } from '../../domain/stateMachine';
import type { Application } from '../../domain/types';
import { useAction, useUser, useUserName } from '../../store/data';
import type { DecisionVariant } from './modals';

export type ActionModal = 'request' | 'reject' | 'waive' | 'return' | DecisionVariant;

/**
 * Панель действий карточки сотрудника по статусу заявки (§12 ТЗ).
 * Неактивная кнопка остаётся видна и объясняет причину при наведении.
 */

function ActionButton({ label, reason, primary, danger, onClick, pending }: { label: string; reason?: string | null; primary?: boolean; danger?: boolean; onClick: () => void; pending?: boolean }) {
  const cls = `btn ${primary ? 'btn--primary' : danger ? 'btn--outline btn--danger-text' : 'btn--outline'}`;
  // title на обёртке: у disabled-кнопки браузер не показывает подсказку
  return (
    <span className="action-bar__btn" title={reason ?? undefined}>
      <button type="button" className={cls} disabled={!!reason || pending} onClick={onClick} aria-label={reason ? `${label}: ${reason}` : undefined}>
        {label}
      </button>
    </span>
  );
}

const isHard = (c: string) => codeInfo(c).level === 'H' || c === 'S01X';

export function ActionBar({ app, onOpen }: { app: Application; onOpen: (m: ActionModal) => void }) {
  const user = useUser();
  const nameOf = useUserName();
  const act = useAction();
  const mine = app.assigneeId === user.id;
  const codes = app.route?.allCodes ?? [];
  const hard = codes.filter(isHard);
  const soft = codes.filter((c) => codeInfo(c).level === 'S');
  const grade = app.scoring?.grade;
  const canDecide = mine && app.status === 'IN_REVIEW' && !app.pendingDecision;

  // Запреты на запрошенных условиях — из расчётного слоя
  const preview = useMemo(
    () => (canDecide && app.financials ? api.applications.preview(app.id, app.requested, 'approve') : null),
    [canDecide, app.id, app.version, app.financials],
  );

  let hint: ReactNode = null;
  const buttons: ReactNode[] = [];
  const run = (fn: () => Promise<unknown>) => act.run(fn);

  if (app.pendingDecision) {
    const p = app.pendingDecision;
    if (p.initiatorId === user.id) {
      hint = `Ждёт второго подтверждения: ${p.reason}`;
    } else {
      hint = `${p.initiatorName} просит подтвердить: ${p.reason}`;
      buttons.push(<ActionButton key="ret" label="Вернуть" onClick={() => onOpen('return')} />);
      buttons.push(
        <ActionButton key="ok" label={act.pending ? 'Подтверждаем…' : 'Подтвердить решение'} primary pending={act.pending} onClick={() => run(() => api.applications.confirmDecision(app.id, user.id))} />,
      );
    }
  } else if (app.status === 'IN_QUEUE') {
    hint = 'Возьмите заявку в работу, чтобы принять решение';
    buttons.push(
      <ActionButton key="take" label={act.pending ? 'Берём…' : 'Взять в работу'} primary pending={act.pending} onClick={() => run(() => api.applications.takeToWork(app.id, user.id))} />,
    );
  } else if (app.status === 'REJECTED' && hard.length) {
    hint = `Отказ по жёсткому стопу ${hard.join(', ')}. Жёсткий стоп снимается только изменением факта в источнике.`;
  } else if (isFinal(app.status)) {
    hint = 'Заявка завершена — только просмотр';
  } else if (app.assigneeId && !mine) {
    hint = `Только просмотр: заявка в работе у ${nameOf(app.assigneeId)}`;
  } else if (app.status === 'NEED_INFO') {
    hint = 'Ждём документы от клиента — после ответа заявка вернётся на проверку';
    buttons.push(<ActionButton key="remind" label={act.pending ? 'Отправляем…' : 'Напомнить клиенту'} pending={act.pending} onClick={() => run(() => api.applications.remind(app.id, user.id))} />);
  } else if (canDecide) {
    const approveReason = preview?.blockers.length ? preview.blockers.join('. ') : null;
    const counterReason = hard.length
      ? `Жёсткий стоп ${hard.join(', ')} — только отказ`
      : grade === 'D' || grade === 'E'
        ? `Группа ${grade} — только отказ`
        : soft.length
          ? `Сначала снимите мягкие стопы: ${soft.join(', ')}`
          : null;
    buttons.push(<ActionButton key="req" label="Запросить документы" onClick={() => onOpen('request')} />);
    if (soft.length) buttons.push(<ActionButton key="waive" label="Снять мягкий стоп" onClick={() => onOpen('waive')} />);
    buttons.push(<ActionButton key="rej" label="Отказать" danger onClick={() => onOpen('reject')} />);
    buttons.push(<ActionButton key="counter" label="Контрпредложение" reason={counterReason} onClick={() => onOpen('counter')} />);
    buttons.push(<ActionButton key="other" label="Одобрить на других условиях" reason={approveReason} onClick={() => onOpen('other_terms')} />);
    buttons.push(<ActionButton key="approve" label="Одобрить" primary reason={approveReason} onClick={() => onOpen('as_requested')} />);
  } else {
    hint = 'Ждём клиента — сейчас действий нет';
  }

  return (
    <div className="action-bar">
      <span className="action-bar__id">№ {app.id}</span>
      {hint && <span className="action-bar__hint">{hint}</span>}
      {act.error && <span className="form-error">{act.error}</span>}
      {buttons}
    </div>
  );
}
