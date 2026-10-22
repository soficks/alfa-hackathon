import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import Sidebar, { type NavItem } from './Sidebar';
import Topbar, { Bell, ProfileMenu } from './Topbar';
import { MascotHead } from '../art/Mascot';
import { api } from '../api';
import { GOALS } from '../config/products';
import { clientAlerts, employeeAlerts } from '../domain/alerts';
import { isFinal } from '../domain/stateMachine';
import type { Application } from '../domain/types';
import { clientNeedsAction } from '../domain/statusText';
import { useDb, useNow, useSession, useUser } from '../store/data';
import { initials } from '../utils/format';

const COLLAPSE_KEY = 'business-cabinet-sidebar';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? 'open' : 'collapsed');
      } catch {
        /* без сохранения */
      }
      return !c;
    });
  return [collapsed, toggle] as const;
}

function Shell({ sidebar, topbar, children }: { sidebar: (collapsed: boolean, toggle: () => void) => ReactNode; topbar: ReactNode; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsed();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className={`app${collapsed ? ' app--collapsed' : ''}`}>
      {sidebar(collapsed, toggle)}
      <div className="workspace">
        {topbar}
        <main className="content">{children}</main>
        <footer className="workspace-footer">
          <span>Бизнес кабинет</span>
          <span>Демонстрационный проект · данные синтетические, без банковских операций</span>
        </footer>
      </div>
    </div>
  );
}

/* ---------- Клиент ---------- */

const CLIENT_CRUMBS: [RegExp, [string, string?][]][] = [
  [/^\/$/, [['Главная']]],
  [/^\/profile$/, [['Личный кабинет']]],
  [/^\/financing$/, [['Финансирование']]],
  [/^\/financing\/calculator$/, [['Финансирование', '/financing'], ['Заявка']]],
  [/^\/applications$/, [['Мои заявки']]],
  [/^\/applications\/(.+)$/, [['Мои заявки', '/applications'], ['Заявка']]],
  [/^\/help$/, [['Помощник']]],
];

function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = CLIENT_CRUMBS.find(([re]) => re.test(pathname))?.[1] ?? [];
  const id = pathname.match(/^\/applications\/(.+)$/)?.[1];
  return (
    <nav className="crumbs" aria-label="Хлебные крошки">
      <Link to="/" aria-label="Главная">
        <Icon name="home" size={15} />
      </Link>
      {crumbs.map(([label, to], i) => (
        <span key={label} className="crumbs__part">
          <Icon name="chevronRight" size={12} className="crumbs__sep" />
          {to ? <Link to={to}>{label}</Link> : <span className="crumbs__current">{id && i === crumbs.length - 1 ? `№ ${id}` : label}</span>}
        </span>
      ))}
    </nav>
  );
}

function useResetAndHome(home: string) {
  const navigate = useNavigate();
  return async () => {
    await api.store.reset();
    navigate(home);
  };
}

export function ClientLayout() {
  const user = useUser();
  const { logout } = useSession();
  const db = useDb();
  const navigate = useNavigate();
  const reset = useResetAndHome('/');
  const mine = db.applications.filter((a) => a.ownerUserId === user.id);
  const draft = mine.find((a) => a.status === 'DRAFT');
  const company = db.companies.find((c) => c.inn === user.companyInn);

  const financeMenu = (close: () => void) => (
    <>
      <span className="mini-label">Финансирование</span>
      <h3 className="finance-menu__title">
        Следующий шаг
        <br />
        для вашего бизнеса
      </h3>
      {GOALS.map((g) => (
        <button
          key={g.id}
          type="button"
          role="menuitem"
          className="finance-menu__item"
          onClick={async () => {
            close();
            await api.applications.newWizard(user.id, { goalId: g.id });
            navigate('/financing/calculator');
          }}
        >
          {g.title}
          <Icon name="arrowRight" size={16} />
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className="finance-menu__item finance-menu__item--accent"
        onClick={async () => {
          close();
          if (draft) await api.applications.resumeDraft(user.id, draft.id);
          navigate('/financing/calculator');
        }}
      >
        {draft ? `Продолжить черновик № ${draft.id}` : 'Открыть калькулятор'}
        <Icon name="chevronRight" size={16} />
      </button>
    </>
  );

  const items: NavItem[] = [
    { to: '/', label: 'Главная', icon: 'home', end: true },
    { to: '/financing', label: 'Финансирование', icon: 'financing', menu: financeMenu },
    { to: '/applications', label: 'Мои заявки', icon: 'document', count: mine.filter(clientNeedsAction).length },
  ];

  return (
    <Shell
      sidebar={(collapsed, toggle) => (
        <Sidebar
          items={items}
          home="/"
          collapsed={collapsed}
          onToggle={toggle}
          bottom={
            <Link to="/help" className="sidebar-help" title={collapsed ? 'Альфа-помощник' : undefined} aria-label="Альфа-помощник">
              <MascotHead size={collapsed ? 40 : 46} className="sidebar-help__cat" />
              {!collapsed && (
                <>
                  <span className="sidebar-help__text">
                    Есть вопрос?
                    <small>Альфа-помощник рядом</small>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </>
              )}
            </Link>
          }
          footer={
            <>
              {!collapsed && (
                <>
                  <span className="demo-dot" />
                  Демо-режим
                </>
              )}
            </>
          }
        />
      )}
      topbar={
        <Topbar>
          <Bell alerts={clientAlerts(mine)} />
          <span className="topbar__divider" />
          <ProfileMenu
            initials={initials(user.firstName, user.lastName)}
            name={`${user.firstName} ${user.lastName}`}
            caption={company?.name ?? user.position}
            items={[
              { label: 'Личный кабинет', icon: 'user', onSelect: () => navigate('/profile') },
              { label: 'Сбросить демо-данные', icon: 'refresh', onSelect: reset },
              { label: 'Выйти', icon: 'logout', onSelect: logout },
            ]}
          />
        </Topbar>
      }
    >
      <Breadcrumbs />
      <Outlet />
    </Shell>
  );
}

/* ---------- Сотрудник ---------- */

export type BankSection = 'queue' | 'my' | 'history';

export function BankLayout() {
  const user = useUser();
  const { logout } = useSession();
  const db = useDb();
  const now = useNow();
  const location = useLocation();
  const reset = useResetAndHome('/bank/queue');

  const queue = db.applications.filter((a) => a.status === 'IN_QUEUE').length;
  const my = db.applications.filter((a) => a.assigneeId === user.id && (a.status === 'IN_REVIEW' || a.status === 'NEED_INFO')).length;
  const history = db.applications.filter((a) => isFinishedBy(a, user.id)).length;

  // В карточке заявки подсвечиваем раздел, из которого её открыли, иначе — по назначению
  const cardId = location.pathname.match(/^\/bank\/applications\/(.+)$/)?.[1];
  let section: BankSection | undefined;
  if (cardId) {
    const from = (location.state as { from?: BankSection } | null)?.from;
    const app = db.applications.find((a) => a.id === cardId);
    section = from ?? (app && app.assigneeId === user.id && !isFinal(app.status) && !app.decision ? 'my' : app && isFinishedBy(app, user.id) ? 'history' : 'queue');
  }

  const items: NavItem[] = [
    { to: '/bank/queue', label: 'Заявки', icon: 'document', count: queue, active: section ? section === 'queue' : undefined },
    { to: '/bank/my', label: 'Мои проверки', icon: 'list', count: my, active: section ? section === 'my' : undefined },
    { to: '/bank/history', label: 'История', icon: 'history', count: history, active: section ? section === 'history' : undefined },
  ];

  return (
    <Shell
      sidebar={(collapsed, toggle) => (
        <Sidebar
          items={items}
          home="/bank/queue"
          collapsed={collapsed}
          onToggle={toggle}
          footer={
            !collapsed ? (
              <>
                <span className="demo-dot" />
                Демо-режим банка
              </>
            ) : undefined
          }
        />
      )}
      topbar={
        <Topbar>
          <Bell alerts={employeeAlerts(db.applications, user.id, now)} />
          <span className="topbar__divider" />
          <ProfileMenu
            initials={initials(user.firstName, user.lastName)}
            name={`${user.firstName} ${user.lastName}`}
            caption={user.position}
            items={[
              { label: 'Сбросить демо-данные', icon: 'refresh', onSelect: reset },
              { label: 'Выйти', icon: 'logout', onSelect: logout },
            ]}
          />
        </Topbar>
      }
    >
      <Outlet context={section} />
    </Shell>
  );
}

/** Проверка завершена сотрудником: он принял решение или клиент отозвал заявку во время его работы. */
export function isFinishedBy(app: Application, employeeId: string) {
  if (app.decision?.decidedById === employeeId) return true;
  return app.status === 'WITHDRAWN' && app.assigneeId === employeeId;
}
