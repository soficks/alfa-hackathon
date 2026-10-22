import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import CurrentApplication from '../components/CurrentApplication';
import StatusBadge from '../components/StatusBadge';
import { Ribbon } from '../art/Ribbon';
import { goalById } from '../store/data';
import { pickCurrentApplication, useStore } from '../store/store';
import { maskTail, months, rub } from '../utils/format';

export default function HomePage() {
  const { state } = useStore();
  const { user, company } = state;
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const current = pickCurrentApplication(state.applications);
  const others = state.applications.filter((a) => a !== current && !(a.status === 'APPROVED' && a.accepted)).slice(0, 3);

  return (
    <div className="home">
      <section className="greeting">
        <span className="avatar avatar--lg">{initials}</span>
        <div>
          <h1 className="page-title">Добрый день, {user.firstName}</h1>
          <p className="page-subtitle">Статус финансирования и следующий шаг для вашего бизнеса</p>
        </div>
      </section>

      {current ? (
        <CurrentApplication app={current} />
      ) : (
        <section className="card empty">
          <h2 className="card-title">Начните с вашей цели</h2>
          <p className="muted">Подберите параметры и создайте первую заявку.</p>
          <Link to="/financing" className="btn btn--primary">
            Подобрать условия <Icon name="arrowRight" size={18} />
          </Link>
        </section>
      )}

      <div className="home__grid">
        <section className="card mini-list">
          <div className="mini-list__head">
            <h2 className="card-title">Другие заявки</h2>
            <Link to="/applications" className="link-btn">
              Все заявки <Icon name="arrowRight" size={16} />
            </Link>
          </div>
          {others.length === 0 && <p className="muted">Других активных заявок нет.</p>}
          {others.map((app) => (
            <Link key={app.id} to={`/applications/${app.id}`} className="mini-list__row">
              <div>
                <strong>{goalById(app.goal).title}</strong>
                <span>
                  № {app.id} · {rub(app.amount)} · {months(app.term)}
                </span>
              </div>
              <StatusBadge app={app} />
            </Link>
          ))}
        </section>

        <section className="card company-mini">
          <div className="company-mini__head">
            <span className="tile-icon">
              <Icon name="building" size={22} />
            </span>
            <div>
              <span className="mini-label">Моя компания</span>
              <h2 className="card-title">{company.name}</h2>
            </div>
          </div>
          <dl className="requisites">
            <div>
              <dt>ИНН</dt>
              <dd>{maskTail(company.inn)}</dd>
            </div>
            <div>
              <dt>{company.type === 'ИП' ? 'ОГРНИП' : 'ОГРН'}</dt>
              <dd>{maskTail(company.ogrn)}</dd>
            </div>
          </dl>
          <Link to="/profile" className="link-btn">
            Подробнее о компании <Icon name="arrowRight" size={16} />
          </Link>
        </section>
      </div>

      <section className="next-plans">
        <div>
          <span className="mini-label">Следующий шаг</span>
          <h2 className="next-plans__title">
            Новые планы?
            <br />
            Найдём возможности.
          </h2>
          <p className="muted">Рассчитайте финансирование под задачи бизнеса — это займёт минуту.</p>
          <Link to="/financing" className="btn btn--outline">
            Подобрать условия <Icon name="arrowRight" size={18} />
          </Link>
        </div>
        <Ribbon className="next-plans__ribbon" />
      </section>
    </div>
  );
}
