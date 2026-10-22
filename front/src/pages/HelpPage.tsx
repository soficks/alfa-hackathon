import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import { MascotAvatar } from '../art/Mascot';
import { QUICK_QUESTIONS, botReply, operatorReply } from '../store/bot';
import { goalById, nextStepText } from '../store/data';
import { pickCurrentApplication, useStore } from '../store/store';
import type { ChatMessage } from '../store/types';
import { months, rub, timeNow } from '../utils/format';

let seq = 0;
const msgId = () => `m${Date.now()}-${seq++}`;

export default function HelpPage() {
  const { state, dispatch } = useStore();
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const timers = useRef<number[]>([]);

  const discussed = pickCurrentApplication(state.applications.filter((a) => a.status !== 'DRAFT'));
  const operatorJoined = state.chat.some((m) => m.from === 'operator');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.chat.length, typing]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const add = (message: Omit<ChatMessage, 'id' | 'time'>) => dispatch({ type: 'chat/add', message: { id: msgId(), time: timeNow(), ...message } });

  const later = (fn: () => void, ms = 900) => {
    setTyping(true);
    timers.current.push(
      window.setTimeout(() => {
        setTyping(false);
        fn();
      }, ms),
    );
  };

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || typing) return;
    add({ from: 'user', text: question });
    setInput('');
    if (state.chatMode === 'operator') later(() => add({ from: 'operator', text: operatorReply() }), 1400);
    else later(() => add({ from: 'bot', ...botReply(question, state) }));
  };

  const callOperator = () => {
    dispatch({ type: 'chat/mode', mode: 'operator' });
    if (operatorJoined) return;
    add({ from: 'system', text: 'Подключаем оператора (демо). Переписка сохранится.' });
    later(() => add({ from: 'operator', text: 'Здравствуйте! Меня зовут Анна, я специалист по кредитам для бизнеса. Чем могу помочь?' }), 1600);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  const startUpload = (appId: string) => {
    uploadTarget.current = appId;
    fileInput.current?.click();
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const appId = uploadTarget.current ?? undefined;
    uploadTarget.current = null;
    add({ from: 'bot', kind: 'file', text: file.name, appId });
    const target = state.applications.find((a) => a.id === appId);
    if (target) {
      dispatch({
        type: 'app/addDocuments',
        id: target.id,
        documents: [{ id: crypto.randomUUID(), name: file.name, size: file.size, addedAt: new Date().toISOString() }],
      });
      if (target.status === 'NEED_INFO') {
        later(() => add({ from: 'bot', text: `Спасибо! Выписка получена — заявка № ${target.id} снова на рассмотрении. Сообщим, когда будет решение.` }));
      }
    }
  };

  return (
    <div className="help">
      <h1 className="page-title">Поможем на каждом шаге</h1>
      <p className="page-subtitle">Задайте вопрос — Альфа-помощник подскажет по заявкам и документам.</p>

      <div className="help__grid">
        <section className="card chat">
          <header className="chat__head">
            <MascotAvatar size={48} />
            <div className="chat__who">
              <strong>Альфа-помощник</strong>
              <span>
                <i className="online-dot" />
                {state.chatMode === 'operator' && operatorJoined ? 'Анна, оператор на связи' : 'Виртуальный помощник · демо'}
              </span>
            </div>
            <button type="button" className="btn btn--outline btn--sm" onClick={callOperator}>
              <Icon name="headset" size={18} /> Позвать оператора
            </button>
          </header>

          <div className="segmented segmented--tabs" role="tablist">
            {(['bot', 'operator'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={state.chatMode === mode}
                className={state.chatMode === mode ? 'is-active' : ''}
                onClick={() => (mode === 'operator' ? callOperator() : dispatch({ type: 'chat/mode', mode }))}
              >
                {mode === 'bot' ? 'Помощник' : 'Оператор'}
              </button>
            ))}
          </div>

          <div className="chat__list" ref={listRef} aria-live="polite">
            {state.chat.map((m, i) => {
              const prev = state.chat[i - 1];
              const continued = !!prev && prev.from === m.from && m.from !== 'user';
              const target = m.appId ? state.applications.find((a) => a.id === m.appId) : undefined;
              return (
                <Message
                  key={m.id}
                  message={m}
                  showAvatar={!continued && m.kind !== 'file'}
                  onChip={ask}
                  onUpload={startUpload}
                  uploadDone={target?.status !== 'NEED_INFO'}
                />
              );
            })}
            {typing && (
              <div className="msg msg--bot">
                <div className="msg__avatar">{state.chatMode === 'operator' ? <OperatorAvatar /> : <MascotAvatar size={40} />}</div>
                <div className="bubble bubble--typing" aria-label="Печатает">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <button
              type="button"
              className="composer__attach"
              aria-label="Прикрепить файл"
              onClick={() => {
                uploadTarget.current = null;
                fileInput.current?.click();
              }}
            >
              <Icon name="paperclip" size={20} />
            </button>
            <input className="composer__input" placeholder="Напишите сообщение" maxLength={2000} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Сообщение" />
            <button type="submit" className="composer__send" aria-label="Отправить" disabled={!input.trim() || typing}>
              <Icon name="send" size={20} strokeWidth={0} />
            </button>
          </form>
          <input ref={fileInput} type="file" hidden accept=".pdf,.xlsx,.csv,.jpg,.png,.docx" onChange={onFile} />
          <p className="micro">Ответы и оператор демонстрационные. Не отправляйте пароли и паспортные данные.</p>
        </section>

        <aside className="card discuss">
          <h2 className="card-title">Обсуждаем заявку</h2>
          {discussed ? (
            <>
              <span className="discuss__num">№ {discussed.id}</span>
              <strong className="discuss__product">{goalById(discussed.goal).title}</strong>
              <StatusBadge app={discussed} />
              <dl className="kv kv--compact">
                <dt>Сумма</dt>
                <dd>{rub(discussed.amount)}</dd>
                <dt>Срок</dt>
                <dd>{months(discussed.term)}</dd>
              </dl>
              <p className="muted discuss__hint">{nextStepText(discussed)}</p>
              <Link to={`/applications/${discussed.id}`} className="btn btn--outline-red btn--block">
                Открыть заявку <Icon name="arrowRight" size={18} />
              </Link>
            </>
          ) : (
            <p className="muted">Активных заявок нет — спросите о продуктах, и помощник подскажет.</p>
          )}
          <div className="discuss__info">
            <Icon name="info" size={18} />
            При подключении оператора переписка сохранится.
          </div>
        </aside>
      </div>
    </div>
  );
}

function OperatorAvatar() {
  return <span className="avatar avatar--operator">А</span>;
}

interface MessageProps {
  message: ChatMessage;
  showAvatar: boolean;
  onChip: (text: string) => void;
  onUpload: (appId: string) => void;
  uploadDone: boolean;
}

function Message({ message: m, showAvatar, onChip, onUpload, uploadDone }: MessageProps) {
  if (m.from === 'system') return <div className="msg-system">{m.text}</div>;

  if (m.from === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__col">
          <div className="bubble bubble--user">{m.text}</div>
          <div className="msg__time">
            {m.time}
            <Icon name="doubleCheck" size={16} strokeWidth={2} className="msg__read" />
          </div>
        </div>
        <span className="avatar avatar--user">
          <Icon name="user" size={22} strokeWidth={0} fill="currentColor" />
        </span>
      </div>
    );
  }

  return (
    <div className="msg msg--bot">
      <div className="msg__avatar">{showAvatar && (m.from === 'operator' ? <OperatorAvatar /> : <MascotAvatar size={40} />)}</div>
      <div className="msg__col">
        {m.kind === 'file' ? (
          <div className="doc-item doc-item--done">
            <Icon name="document" size={22} className="doc-item__icon" />
            <div className="doc-item__text">
              <strong>{m.text}</strong>
              <span>Файл загружен{m.appId ? ` · заявка № ${m.appId}` : ''}</span>
            </div>
            <Icon name="checkCircle" size={20} className="doc-item__ok" />
          </div>
        ) : (
          <div className="bubble">
            {m.from === 'operator' && <span className="bubble__author">Анна, оператор</span>}
            {m.text}
          </div>
        )}
        <div className="msg__time">{m.time}</div>

        {m.kind === 'greeting' && (
          <div className="chips">
            {QUICK_QUESTIONS.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => onChip(q)}>
                {q}
                <Icon name="chevronRight" size={16} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        )}

        {m.kind === 'upload' && m.appId && !uploadDone && (
          <button type="button" className="upload-btn" onClick={() => onUpload(m.appId!)}>
            <Icon name="document" size={22} />
            Загрузить выписку
          </button>
        )}
      </div>
    </div>
  );
}
