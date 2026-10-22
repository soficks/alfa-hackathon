import { useState, type FormEvent } from 'react';
import Field from '../components/Field';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { HeroRibbons } from '../art/Ribbon';
import type { Role } from '../domain/types';
import { useDb, useSession } from '../store/data';

const ROLES: { id: Role; label: string }[] = [
  { id: 'client', label: 'Я предприниматель' },
  { id: 'employee', label: 'Я сотрудник банка' },
];

export default function LoginPage() {
  const { login } = useSession();
  const db = useDb();
  const [role, setRole] = useState<Role>('client');
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const demoUser = db.users.find((u) => u.role === role);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!loginValue.trim() || !password) {
      setError('Введите логин и пароль или нажмите «Демо-вход»');
      return;
    }
    // пароль нигде не сохраняется: в демо подходит любой
    setPassword('');
    login(role);
  };

  return (
    <div className="login">
      <aside className="login__rail">
        <div className="logo">
          <LogoMark />
          <span className="logo__text">
            Бизнес
            <br />
            кабинет
          </span>
        </div>
        <p className="login__rail-note">
          Финансирование
          <br />
          вашего бизнеса
        </p>
      </aside>

      <section className="login__hero">
        <span className="mini-label mini-label--light">Бизнес кабинет</span>
        {/* Альтернативы слогана: «Заявка за 10 минут, статус всегда перед глазами»; «Кредит для бизнеса без лишних бумаг» */}
        <h1 className="login__title">
          Финансирование для бизнеса — понятно на каждом шаге
        </h1>
        <p className="login__lead">Выберите цель, рассчитайте платёж и следите за заявкой в одном кабинете.</p>
        <HeroRibbons className="login__ribbons" />
      </section>

      <section className="login__side">
        <form className="login__card card" onSubmit={onSubmit} noValidate>
          <div className="segmented segmented--wide" role="radiogroup" aria-label="Кто входит">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={role === r.id}
                className={role === r.id ? 'is-active' : ''}
                onClick={() => {
                  setRole(r.id);
                  setError('');
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <h2 className="login__card-title">{role === 'client' ? 'Вход в кабинет' : 'Вход для сотрудника'}</h2>
          <p className="muted">
            {role === 'client' ? 'Заявки, расчёт платежа и переписка со специалистом.' : 'Очередь заявок, проверки и решения.'}
          </p>

          <Field label="Логин">
            <input
              className="input"
              autoComplete="username"
              placeholder="Любой демо-логин"
              value={loginValue}
              onChange={(e) => {
                setLoginValue(e.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="Пароль">
            <span className="input-wrap">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Любой демо-пароль"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
              />
              <button type="button" className="input-wrap__btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </span>
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--lg btn--block">
            Войти <Icon name="arrowRight" size={18} />
          </button>
          <button type="button" className="btn btn--outline btn--lg btn--block" onClick={() => login(role)}>
            Демо-вход{demoUser ? `: ${demoUser.firstName} ${demoUser.lastName}, ${demoUser.position.toLowerCase()}` : ''}
          </button>

          <div className="notice">
            <Icon name="info" size={18} />
            Демонстрационный кабинет: данные синтетические, пароль не сохраняется. Откройте вторую вкладку с другой ролью — изменения видны сразу.
          </div>
        </form>
      </section>
    </div>
  );
}
