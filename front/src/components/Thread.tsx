import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { api } from '../api';
import type { Application, HistoryEvent, Role } from '../domain/types';
import { useAction, useUser } from '../store/data';
import { dateTime } from '../utils/format';

/** Переписка клиента и специалиста по заявке. */
export function MessagesThread({ app, canWrite, hint }: { app: Application; canWrite: boolean; hint?: string }) {
  const user = useUser();
  const [text, setText] = useState('');
  const { run, pending, error } = useAction();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [app.messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await run(() => api.applications.sendMessage(app.id, user.id, text));
    if (ok) setText('');
  };

  return (
    <div className="thread">
      <div className="thread__list" ref={listRef} aria-live="polite">
        {app.messages.length === 0 && <p className="muted thread__empty">Сообщений пока нет.</p>}
        {app.messages.map((m) => {
          const mine = m.author === user.role;
          return (
            <div key={m.id} className={`thread__msg${mine ? ' is-mine' : ''}`}>
              <div className="bubble">
                {!mine && <span className="bubble__author">{m.authorName}</span>}
                {m.text}
              </div>
              <span className="msg__time">
                {dateTime(m.createdAt)}
                {mine && (m.author === 'client' ? m.readByEmployee : m.readByClient) && <Icon name="doubleCheck" size={14} className="msg__read" aria-label="прочитано" />}
              </span>
            </div>
          );
        })}
      </div>
      {hint && <p className="thread__hint">{hint}</p>}
      {canWrite ? (
        <form className="composer" onSubmit={send}>
          <input
            className="composer__input"
            placeholder={user.role === 'client' ? 'Написать специалисту' : 'Написать клиенту'}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            aria-label="Сообщение"
          />
          <button type="submit" className="composer__send" aria-label="Отправить" disabled={!text.trim() || pending}>
            <Icon name="send" size={18} strokeWidth={0} />
          </button>
        </form>
      ) : null}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const ACTOR_LABEL: Record<HistoryEvent['actor'], string> = { system: 'Система', client: 'Клиент', employee: 'Сотрудник' };

/** История событий: клиент видит только свои события и формулировки. */
export function HistoryList({ events, role }: { events: HistoryEvent[]; role: Role }) {
  const visible = (role === 'client' ? events.filter((e) => e.visibleToClient) : events).slice().reverse();
  if (!visible.length) return <p className="muted">Событий пока нет.</p>;
  return (
    <ol className="timeline">
      {visible.map((e, i) => (
        <li key={e.id} className={i === 0 ? 'is-last' : ''}>
          <span className="timeline__dot" />
          <strong>{role === 'client' ? e.clientText ?? e.text : e.text}</strong>
          <small>
            {dateTime(e.at)}
            {role === 'employee' && ` · ${ACTOR_LABEL[e.actor]}${e.actorName && e.actor !== 'system' ? `: ${e.actorName}` : ''}`}
            {role === 'employee' && !e.visibleToClient && ' · внутреннее'}
          </small>
        </li>
      ))}
    </ol>
  );
}
