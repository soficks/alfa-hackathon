import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { MascotHead } from '../art/Mascot';
import { GOALS } from '../store/data';
import { findDraft, useStore } from '../store/store';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/financing', label: 'Финансирование', icon: 'financing' },
  { to: '/applications', label: 'Мои заявки', icon: 'document' },
  { to: '/help', label: 'Помощь', icon: 'help' },
];

interface Props {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ collapsed = false, onToggle }: Props) {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const draft = findDraft(state.applications);

  const openGoal = (goal: (typeof GOALS)[number]['id']) => {
    dispatch({ type: 'wizard/new', goal });
    setMenuOpen(false);
    navigate('/financing/calculator');
  };

  const continueDraft = () => {
    if (draft) dispatch({ type: 'wizard/resume', id: draft.id });
    setMenuOpen(false);
    navigate('/financing/calculator');
  };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__top">
        <Link to="/" className="sidebar__logo" aria-label="Бизнес кабинет — на главную">
          <Logo compact={collapsed} />
        </Link>
        <button
          type="button"
          className="sidebar__toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <Icon name="chevronsLeft" size={18} strokeWidth={1.8} style={collapsed ? { transform: 'scaleX(-1)' } : undefined} />
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Основное меню">
        {NAV.map((item) => {
          const isFinance = item.to === '/financing';
          return (
            <div
              key={item.to}
              className="nav-slot"
              onMouseEnter={isFinance ? () => setMenuOpen(true) : undefined}
              onMouseLeave={isFinance ? () => setMenuOpen(false) : undefined}
              onKeyDown={isFinance ? (e) => e.key === 'Escape' && setMenuOpen(false) : undefined}
            >
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
                title={collapsed ? item.label : undefined}
                onFocus={isFinance ? () => setMenuOpen(true) : undefined}
                aria-haspopup={isFinance ? 'menu' : undefined}
                aria-expanded={isFinance ? menuOpen : undefined}
              >
                <Icon name={item.icon} size={22} strokeWidth={1.6} />
                <span className="nav-item__label">{item.label}</span>
              </NavLink>

              {isFinance && menuOpen && (
                <div className="finance-menu" role="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenuOpen(false)}>
                  <span className="mini-label">Финансирование</span>
                  <h3 className="finance-menu__title">
                    Следующий шаг
                    <br />
                    для вашего бизнеса
                  </h3>
                  {GOALS.map((goal) => (
                    <button key={goal.id} type="button" role="menuitem" className="finance-menu__item" onClick={() => openGoal(goal.id)}>
                      {goal.title}
                      <Icon name="arrowRight" size={16} />
                    </button>
                  ))}
                  <button type="button" role="menuitem" className="finance-menu__item finance-menu__item--accent" onClick={continueDraft}>
                    {draft ? `Продолжить черновик № ${draft.id}` : 'Открыть калькулятор'}
                    <Icon name="chevronRight" size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <Link to="/help" className="sidebar-help" title={collapsed ? 'Помощь' : undefined}>
        <MascotHead size={collapsed ? 40 : 46} className="sidebar-help__cat" />
        {!collapsed && (
          <>
            <span className="sidebar-help__text">
              Есть вопрос?
              <small>Мы рядом</small>
            </span>
            <Icon name="chevronRight" size={16} />
          </>
        )}
      </Link>

      <div className="sidebar__footer">
        {!collapsed && (
          <>
            <span className="demo-dot" />
            Демо-режим
          </>
        )}
        <button type="button" className="sidebar__logout" aria-label="Выйти из кабинета" title="Выйти" onClick={() => dispatch({ type: 'logout' })}>
          <Icon name="logout" size={18} />
        </button>
      </div>
    </aside>
  );
}
