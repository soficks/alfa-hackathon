import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { CompanyCard } from '../../components/Terms';
import { api } from '../../api';
import { accountsFor } from '../../domain/accounts';
import { useDb, useUser } from '../../store/data';
import { initials } from '../../utils/format';
import { CurrentApplicationCard, pickCurrent } from './common';

export default function ProfilePage() {
  const user = useUser();
  const db = useDb();
  const navigate = useNavigate();
  const company = db.companies.find((c) => c.inn === user.companyInn);
  const mine = db.applications.filter((a) => a.ownerUserId === user.id);
  const current = pickCurrent(mine);
  const sent = mine.filter((a) => a.status !== 'DRAFT').length;
  const issued = mine.filter((a) => a.status === 'ISSUED').length;

  return (
    <div className="profile">
      <h1 className="page-title">Личный кабинет</h1>
      <p className="page-subtitle">Ваш профиль, полномочия и компания</p>

      <section className="card profile-card">
        <span className="avatar avatar--xl">{initials(user.firstName, user.lastName)}</span>
        <div className="profile-card__info">
          <span className="mini-label">Ваш профиль</span>
          <h2 className="profile-card__name">
            {user.firstName} {user.lastName}
          </h2>
          <p className="muted">{user.position}</p>
          <div className="profile-card__contacts">
            <span>{user.email}</span>
            <span>{user.phone}</span>
          </div>
          {user.authority && (
            <p className="profile-card__authority">
              <Icon name="shield" size={16} /> Полномочия: {user.authority}
            </p>
          )}
        </div>
        <dl className="profile-card__stats">
          <div>
            <dt>Заявок отправлено</dt>
            <dd>{sent}</dd>
          </div>
          <div>
            <dt>Кредитов выдано</dt>
            <dd>{issued}</dd>
          </div>
        </dl>
      </section>

      {current && <CurrentApplicationCard app={current} />}

      {company && (
        <section className="card company-card">
          <h2 className="card-title">Привязанная компания</h2>
          <p className="muted form-note">Данные берём из реестра — изменить их здесь нельзя. Если в реестре что-то устарело, обновите сведения в налоговой.</p>
          <CompanyCard company={company} />
        </section>
      )}

      {company && (
        <section className="card">
          <h2 className="card-title">Счета компании</h2>
          <ul className="accounts accounts--list">
            {accountsFor(company.inn, db.accounts).map((a) => (
              <li key={a.number} className="account">
                <Icon name="wallet" size={20} />
                <span>
                  <strong>{a.title}</strong>
                  <span className="muted">{a.number}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="micro">Демо-счета: на один из них зачисляется кредит после подписания.</p>
        </section>
      )}

      <div className="profile__actions">
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={async () => {
            await api.store.reset();
            navigate('/');
          }}
        >
          <Icon name="refresh" size={16} /> Сбросить демо-данные
        </button>
        <p className="micro">Вернёт заявки, сообщения и черновики к исходному демо-состоянию — в обоих кабинетах.</p>
      </div>
    </div>
  );
}
