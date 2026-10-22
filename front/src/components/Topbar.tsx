import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import StatusBadge from './StatusBadge';
import { needsAction, nextStepText } from '../store/data';
import { useStore } from '../store/store';

export default function Topbar() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = `${state.user.firstName[0] ?? ''}${state.user.lastName[0] ?? ''}`.toUpperCase();
  const alerts = state.applications.filter(needsAction);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="topbar">
      <nav className="topnav" aria-label="Быстрые действия">
        <NavLink to="/financing/calculator" className="topnav__link">
          Калькулятор
        </NavLink>
        <NavLink to="/applications" className="topnav__link">
          Мои заявки
        </NavLink>
      </nav>

      <div className="topbar__right">
        <div className="dropdown" ref={ref}>
          <button type="button" className="icon-btn" aria-label={`Уведомления: ${alerts.length}`} onClick={() => setOpen((v) => !v)}>
            <Icon name="bell" size={22} strokeWidth={1.6} />
            {alerts.length > 0 && <span className="icon-btn__dot" />}
          </button>
          {open && (
            <div className="dropdown__menu dropdown__menu--right dropdown__menu--wide">
              <div className="dropdown__title">Уведомления</div>
              {alerts.length === 0 && <div className="dropdown__empty">Новых уведомлений нет</div>}
              {alerts.map((app) => (
                <Link key={app.id} to={`/applications/${app.id}`} className="dropdown__item" onClick={() => setOpen(false)}>
                  <span className="dropdown__row">
                    <strong>Заявка № {app.id}</strong>
                    <StatusBadge app={app} />
                  </span>
                  <span>{nextStepText(app)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <span className="topbar__divider" />

        <NavLink to="/profile" className="profile-btn">
          <span className="avatar avatar--sm">{initials}</span>
          <span className="profile-btn__text">
            Личный кабинет
            <small>
              {state.user.firstName} {state.user.lastName}
            </small>
          </span>
          <Icon name="chevronRight" size={16} />
        </NavLink>
      </div>
    </header>
  );
}
