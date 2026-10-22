import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const CRUMBS: [RegExp, string[]][] = [
  [/^\/$/, ['Главная']],
  [/^\/profile$/, ['Личный кабинет']],
  [/^\/financing$/, ['Финансирование']],
  [/^\/financing\/calculator$/, ['Финансирование', 'Расчёт условий']],
  [/^\/applications$/, ['Мои заявки']],
  [/^\/applications\/.+/, ['Мои заявки', 'Заявка']],
  [/^\/help$/, ['Помощь']],
];

const CRUMB_LINKS: Record<string, string> = { Финансирование: '/financing', 'Мои заявки': '/applications' };

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = CRUMBS.find(([re]) => re.test(pathname))?.[1] ?? [];
  return (
    <nav className="crumbs" aria-label="Хлебные крошки">
      <Link to="/" aria-label="Главная">
        <Icon name="home" size={15} />
      </Link>
      {crumbs.map((c, i) => (
        <span key={c} className="crumbs__part">
          <Icon name="chevronRight" size={12} className="crumbs__sep" />
          {i < crumbs.length - 1 && CRUMB_LINKS[c] ? <Link to={CRUMB_LINKS[c]}>{c}</Link> : <span className="crumbs__current">{c}</span>}
        </span>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('business-cabinet-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });

  useEffect(() => window.scrollTo(0, 0), [pathname]);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('business-cabinet-sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* без сохранения */
      }
      return !c;
    });

  return (
    <div className={`app${collapsed ? ' app--collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="workspace">
        <Topbar />
        <main className="content">
          <Breadcrumbs pathname={pathname} />
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>Бизнес кабинет</span>
          <span>Демонстрационный проект · без банковских операций</span>
        </footer>
      </div>
    </div>
  );
}
