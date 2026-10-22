import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import CurrentApplication from '../components/CurrentApplication';
import { pickCurrentApplication, useStore } from '../store/store';

export default function ProfilePage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { user, company } = state;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const current = pickCurrentApplication(state.applications);
  const total = state.applications.filter((a) => a.status !== 'DRAFT').length;
  const issued = state.applications.filter((a) => a.status === 'APPROVED' && a.accepted).length;

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const [firstName = '', ...rest] = nameDraft.trim().split(/\s+/);
    if (firstName) dispatch({ type: 'setUserName', firstName, lastName: rest.join(' ') });
    setEditing(false);
  };

  return (
    <div className="profile">
      <h1 className="page-title">Личный кабинет</h1>
      <p className="page-subtitle">Ваш профиль, компания и текущая заявка</p>

      <section className="card profile-card">
        <span className="avatar avatar--xl">{initials}</span>
        <div className="profile-card__info">
          <span className="mini-label">Ваш профиль</span>
          {editing ? (
            <form className="profile-card__edit" onSubmit={saveName}>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus aria-label="Имя и фамилия" />
              <button type="submit" className="btn btn--primary btn--sm">
                Сохранить
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(false)}>
                Отмена
              </button>
            </form>
          ) : (
            <h2 className="profile-card__name">
              {user.firstName} {user.lastName}
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label="Изменить имя"
                onClick={() => {
                  setNameDraft(`${user.firstName} ${user.lastName}`);
                  setEditing(true);
                }}
              >
                <Icon name="pencil" size={18} />
              </button>
            </h2>
          )}
          <p className="muted">{user.role}</p>
          <div className="profile-card__contacts">
            <span>{user.email}</span>
            <span>{user.phone}</span>
          </div>
        </div>
        <dl className="profile-card__stats">
          <div>
            <dt>Заявок отправлено</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>Кредитов выдано</dt>
            <dd>{issued}</dd>
          </div>
        </dl>
      </section>

      {current && <CurrentApplication app={current} />}

      <section className="card company-card">
        <div className="company-mini__head">
          <span className="tile-icon">
            <Icon name="building" size={22} />
          </span>
          <div>
            <span className="mini-label">Моя компания</span>
            <h2 className="card-title">{company.name}</h2>
          </div>
        </div>
        <dl className="requisites requisites--grid">
          <div>
            <dt>ИНН</dt>
            <dd>{company.inn}</dd>
          </div>
          <div>
            <dt>{company.type === 'ИП' ? 'ОГРНИП' : 'ОГРН'}</dt>
            <dd>{company.ogrn}</dd>
          </div>
          <div>
            <dt>Форма</dt>
            <dd>{company.type}</dd>
          </div>
          <div>
            <dt>Юридический адрес</dt>
            <dd>{company.address}</dd>
          </div>
          <div>
            <dt>Контактное лицо</dt>
            <dd>{company.contact}</dd>
          </div>
          <div>
            <dt>Контакты</dt>
            <dd>
              {company.phone}
              <br />
              {company.email}
            </dd>
          </div>
        </dl>
      </section>

      <div className="profile__actions">
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => {
            dispatch({ type: 'reset' });
            navigate('/');
          }}
        >
          <Icon name="refresh" size={16} /> Сбросить демо-данные
        </button>
        <p className="micro">Профиль и реквизиты демонстрационные. Данные хранятся только в этом браузере.</p>
      </div>
    </div>
  );
}
