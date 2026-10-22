import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import type { Alert } from '../domain/alerts';

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function Bell({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutsideClose(open, close);
  const navigate = useNavigate();
  const fresh = alerts.filter((a) => a.fresh).length;

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={fresh ? `Уведомления: ${fresh} новых` : 'Уведомления'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={22} strokeWidth={1.6} />
        {fresh > 0 && <span className="icon-btn__dot" />}
      </button>
      {open && (
        <div className="dropdown__menu dropdown__menu--right dropdown__menu--wide">
          <div className="dropdown__title">Уведомления</div>
          {alerts.length === 0 && <div className="dropdown__empty">Новых уведомлений нет</div>}
          {alerts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="dropdown__item"
              onClick={() => {
                close();
                navigate(a.to);
              }}
            >
              <span className="dropdown__row">
                <strong>{a.title}</strong>
                {a.fresh && <span className="dropdown__new" aria-label="новое" />}
              </span>
              <span>{a.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ProfileMenuItem {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onSelect: () => void;
}

export function ProfileMenu({ initials, name, caption, items }: { initials: string; name: string; caption: string; items: ProfileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutsideClose(open, close);
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="profile-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <span className="avatar avatar--sm">{initials}</span>
        <span className="profile-btn__text">
          {name}
          <small>{caption}</small>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="dropdown__menu dropdown__menu--right" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="dropdown__item dropdown__item--row"
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              <Icon name={it.icon} size={18} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Topbar({ children }: { children: ReactNode }) {
  return (
    <header className="topbar">
      <span />
      <div className="topbar__right">{children}</div>
    </header>
  );
}
