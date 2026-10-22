import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { LogoText, LogoToggle } from './Logo';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  count?: number;
  /** явно задать активность (например, раздел, из которого открыта карточка) */
  active?: boolean;
  /** выпадающая панель при наведении */
  menu?: (close: () => void) => ReactNode;
}

interface Props {
  items: NavItem[];
  home: string;
  collapsed: boolean;
  onToggle: () => void;
  /** блок над футером (кот-помощник) */
  bottom?: ReactNode;
  footer?: ReactNode;
}

function NavEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div
      className="nav-slot"
      onMouseEnter={item.menu ? () => setOpen(true) : undefined}
      onMouseLeave={item.menu ? close : undefined}
      onKeyDown={item.menu ? (e) => e.key === 'Escape' && close() : undefined}
      onBlur={item.menu ? (e) => !e.currentTarget.contains(e.relatedTarget) && close() : undefined}
    >
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) => `nav-item${(item.active ?? isActive) ? ' nav-item--active' : ''}`}
        title={collapsed ? item.label : undefined}
        onFocus={item.menu ? () => setOpen(true) : undefined}
        aria-haspopup={item.menu ? 'menu' : undefined}
        aria-expanded={item.menu ? open : undefined}
        aria-current={item.active ? 'page' : undefined}
      >
        <Icon name={item.icon} size={22} strokeWidth={1.6} />
        <span className="nav-item__label">{item.label}</span>
        {item.count !== undefined && item.count > 0 && <span className="nav-item__count">{item.count}</span>}
      </NavLink>
      {item.menu && open && (
        <div className="finance-menu" role="menu">
          {item.menu(close)}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ items, home, collapsed, onToggle, bottom, footer }: Props) {
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__top">
        <LogoToggle collapsed={collapsed} onToggle={onToggle} />
        {!collapsed && <LogoText to={home} />}
      </div>
      <nav className="sidebar__nav" aria-label="Основное меню">
        {items.map((item) => (
          <NavEntry key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>
      {bottom}
      {footer && <div className="sidebar__footer">{footer}</div>}
    </aside>
  );
}
