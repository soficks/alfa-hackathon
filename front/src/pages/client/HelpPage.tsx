import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ClientStatusBadge } from '../../components/StatusBadge';
import { UploadButton, demoFile } from '../../components/Docs';
import { MascotAvatar } from '../../art/Mascot';
import { api, type NewDocFile } from '../../api';
import { goalById } from '../../config/products';
import { QUICK_QUESTIONS } from '../../config/help';
import { clientNextStep, openRequests } from '../../domain/statusText';
import type { BotMessage } from '../../domain/types';
import { useAction, useDb, useUser } from '../../store/data';
import { months, rub, time } from '../../utils/format';
import { isActive, pickCurrent, termsOf } from './common';

export default function HelpPage() {
  const user = useUser();
  const db = useDb();
  const messages = api.chat.getMessages(user.id);
  const [input, setInput] = useState('');
  const { run, pending } = useAction();
  const listRef = useRef<HTMLDivElement>(null);
  const mine = db.applications.filter((a) => a.ownerUserId === user.id);
  const discussed = pickCurrent(mine.filter(isActive));

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending]);

  const ask = (text: string) => {
    if (!text.trim() || pending) return;
    setInput('');
    run(() => api.chat.ask(user.id, text));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  const attach = (files: NewDocFile[], appId?: string, requestId?: string) => run(() => api.chat.attachFile(user.id, files[0], appId, requestId));

  return (
    <div className="help">
      <h1 className="page-title">Поможем на каждом шаге</h1>
      <p className="page-subtitle">Альфа-помощник подскажет по документам, платежу и статусу заявок.</p>

      <div className="help__grid">
        <section className="card chat">
          <header className="chat__head">
            <MascotAvatar size={48} />
            <div className="chat__who">
              <strong>Альфа-помощник</strong>
              <span>
                <i className="online-dot" />
                Отвечает по данным вашего кабинета
              </span>
            </div>
          </header>

          <div className="chat__list" ref={listRef} aria-live="polite">
            {messages.map((m, i) => (
              <Message key={m.id} message={m} showAvatar={m.from === 'bot' && messages[i - 1]?.from !== 'bot'} onChip={ask} onAttach={attach} />
            ))}
            {pending && (
              <div className="msg msg--bot">
                <div className="msg__avatar">
                  <MascotAvatar size={40} />
                </div>
                <div className="bubble bubble--typing" aria-label="Печатает">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <div className="chips chips--bar">
            {QUICK_QUESTIONS.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={pending}>
                {q}
              </button>
            ))}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <input className="composer__input" placeholder="Напишите вопрос" maxLength={2000} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Вопрос помощнику" />
            <button type="submit" className="composer__send" aria-label="Отправить" disabled={!input.trim() || pending}>
              <Icon name="send" size={20} strokeWidth={0} />
            </button>
          </form>
          <p className="micro">Помощник работает по правилам и данным кабинета. Вопрос по конкретной заявке лучше задать специалисту в её карточке.</p>
        </section>

        <aside className="card discuss">
          <h2 className="card-title">Ваша заявка</h2>
          {discussed ? (
            <>
              <span className="discuss__num">№ {discussed.id}</span>
              <strong className="discuss__product">{goalById(discussed.goalId).title}</strong>
              <ClientStatusBadge app={discussed} />
              <dl className="kv kv--compact">
                <dt>Сумма</dt>
                <dd>{rub(termsOf(discussed).amount)}</dd>
                <dt>Срок</dt>
                <dd>{months(termsOf(discussed).term)}</dd>
              </dl>
              <p className="muted discuss__hint">{clientNextStep(discussed)}</p>
              <Link to={`/applications/${discussed.id}#messages`} className="btn btn--outline-red btn--block">
                Написать специалисту <Icon name="arrowRight" size={18} />
              </Link>
            </>
          ) : (
            <p className="muted">Отправленных заявок нет — спросите о продуктах, и помощник подскажет.</p>
          )}
          <div className="discuss__info">
            <Icon name="info" size={18} />
            Не отправляйте в чат пароли и паспортные данные.
          </div>
        </aside>
      </div>
    </div>
  );
}

function Message({
  message: m,
  showAvatar,
  onChip,
  onAttach,
}: {
  message: BotMessage;
  showAvatar: boolean;
  onChip: (q: string) => void;
  onAttach: (files: NewDocFile[], appId?: string, requestId?: string) => void;
}) {
  const db = useDb();
  if (m.from === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__col">
          {m.kind === 'file' ? (
            <div className="doc-item doc-item--done">
              <Icon name="document" size={20} className="doc-item__icon" />
              <div className="doc-item__text">
                <strong>{m.text}</strong>
                <span>Файл отправлен{m.appId ? ` · заявка № ${m.appId}` : ''}</span>
              </div>
            </div>
          ) : (
            <div className="bubble bubble--user">{m.text}</div>
          )}
          <div className="msg__time">{time(m.at)}</div>
        </div>
      </div>
    );
  }

  const app = m.appId ? db.applications.find((a) => a.id === m.appId) : undefined;
  const request = app?.docRequests.find((r) => r.id === m.requestId);
  const stillOpen = !!(app && request && openRequests(app).includes(request));

  return (
    <div className="msg msg--bot">
      <div className="msg__avatar">{showAvatar && <MascotAvatar size={40} />}</div>
      <div className="msg__col">
        <div className="bubble">{m.text}</div>
        {m.links && (
          <div className="msg__links">
            {m.links.map((l) => (
              <Link key={l.to} to={l.to} className="link-btn link-btn--red">
                {l.label} <Icon name="arrowRight" size={14} />
              </Link>
            ))}
          </div>
        )}
        <div className="msg__time">{time(m.at)}</div>
        {m.kind === 'greeting' && (
          <div className="chips">
            {QUICK_QUESTIONS.slice(0, 4).map((q) => (
              <button key={q} type="button" className="chip" onClick={() => onChip(q)}>
                {q}
                <Icon name="chevronRight" size={16} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        )}
        {m.kind === 'upload' && request && stillOpen && (
          <div className="msg__upload">
            <UploadButton docType={request.docType} variant="primary" label="Загрузить" onFiles={(files) => onAttach(files, m.appId, request.id)} />
            <button type="button" className="link-btn" onClick={() => onAttach([demoFile(request.docType)], m.appId, request.id)}>
              Демо-файл
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
