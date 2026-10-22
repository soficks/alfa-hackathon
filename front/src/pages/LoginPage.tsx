import { useState, type FormEvent } from 'react';
import Field from '../components/Field';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { HeroRibbons } from '../art/Ribbon';
import { useStore } from '../store/store';

export default function LoginPage() {
  const { dispatch } = useStore();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) {
      setError('Введите демо-логин и пароль или нажмите «Демо-вход»');
      return;
    }
    dispatch({ type: 'login' });
  };

  return (
    <div className="login">
      <aside className="login__rail">
        <Logo />
        <p className="login__rail-note">
          Финансирование
          <br />
          вашего бизнеса
        </p>
      </aside>

      <section className="login__hero">
        <span className="mini-label mini-label--light">Бизнес кабинет</span>
        <h1 className="login__title">
          Бизнес растёт.
          <br />
          Мы рядом.
        </h1>
        <p className="login__lead">
          Финансирование, оборудование, развитие —
          <br />в одном кабинете.
        </p>
        <HeroRibbons className="login__ribbons" />
      </section>

      <section className="login__side">
        <form className="login__card card" onSubmit={onSubmit} noValidate>
          <span className="mini-label">Ваш бизнес. Ваши возможности.</span>
          <h2 className="login__card-title">Вход в кабинет</h2>
          <p className="muted">Рады видеть вас снова</p>

          <Field label="Логин">
            <input
              className="input"
              autoComplete="username"
              placeholder="Любой демо-логин"
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
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
          <button type="button" className="btn btn--outline btn--lg btn--block" onClick={() => dispatch({ type: 'login' })}>
            Демо-вход
          </button>

          <div className="notice">
            <Icon name="info" size={18} />
            Демонстрационный кабинет. Используйте вымышленные данные и пароль.
          </div>
        </form>
      </section>
    </div>
  );
}
