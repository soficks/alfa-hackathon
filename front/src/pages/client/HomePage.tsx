import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { ClientStatusBadge } from '../../components/StatusBadge';
import { Ribbon } from '../../art/Ribbon';
import { goalById, productById } from '../../config/products';
import { DAY } from '../../domain/time';
import { openRequests } from '../../domain/statusText';
import type { Application } from '../../domain/types';
import { useDb, useNow, useUser } from '../../store/data';
import { dayMonth, initials, maskTail, months, percent, rub } from '../../utils/format';
import { CurrentApplicationCard, UnreadBadge, isActive, pickCurrent, termsOf, useOpenApplication } from './common';

interface Tip {
  id: string;
  icon: IconName;
  text: string;
  to?: string;
  link?: string;
}

/** Лента «Новости и подсказки»: персональные карточки по правилам из данных клиента. */
function buildTips(apps: Application[], now: Date): Tip[] {
  const tips: Tip[] = [];
  for (const a of apps) {
    for (const r of openRequests(a)) {
      const left = new Date(r.dueAt).getTime() - now.getTime();
      if (left > 0 && left < 1.5 * DAY) {
        tips.push({ id: `due-${r.id}`, icon: 'clock', text: `Срок ответа по заявке № ${a.id} истекает ${dayMonth(r.dueAt)}. Загрузите документы, чтобы проверка не остановилась.`, to: `/applications/${a.id}#requests`, link: 'Загрузить' });
      }
    }
  }
  const withFin = [...apps].reverse().find((a) => a.financials?.avgTurnover12m);
  if (withFin?.financials) {
    const change = withFin.financials.avgTurnover3m / withFin.financials.avgTurnover12m - 1;
    if (change >= 0.05) tips.push({ id: 'turnover', icon: 'sparkle', text: `Ваш оборот за 3 месяца вырос на ${percent(change)} к среднему за год — это поможет при следующей заявке.` });
    if (change <= -0.1) tips.push({ id: 'turnover-down', icon: 'info', text: `Обороты за 3 месяца снизились на ${percent(-change)}. Если нужен кредит, выберите срок подлиннее — платёж будет ниже.` });
  }
  const growthProduct = productById('investment');
  if (!apps.some((a) => a.productId === growthProduct.id && isActive(a))) {
    tips.push({ id: 'grace', icon: 'calendar', text: `Для покупки оборудования доступна отсрочка платежа до ${growthProduct.maxGraceMonths} месяцев — пока оборудование запускается.`, to: '/financing', link: 'Посмотреть' });
  }
  return tips.slice(0, 3);
}

export default function HomePage() {
  const user = useUser();
  const db = useDb();
  const now = useNow();
  const open = useOpenApplication();
  const mine = db.applications.filter((a) => a.ownerUserId === user.id);
  const current = pickCurrent(mine);
  const others = mine.filter((a) => a !== current && (isActive(a) || a.status === 'DRAFT')).slice(0, 4);
  const company = db.companies.find((c) => c.inn === user.companyInn);
  const tips = buildTips(mine, now);

  return (
    <div className="home">
      <section className="greeting">
        <span className="avatar avatar--lg">{initials(user.firstName, user.lastName)}</span>
        <div>
          <h1 className="page-title">Добрый день, {user.firstName}</h1>
          <p className="page-subtitle">Статус заявок и следующий шаг для вашего бизнеса</p>
        </div>
      </section>

      {current ? (
        <CurrentApplicationCard app={current} />
      ) : (
        <section className="card empty">
          <h2 className="card-title">Начните с вашей цели</h2>
          <p className="muted">Подберите параметры и создайте первую заявку.</p>
          <Link to="/financing" className="btn btn--primary">
            Подобрать условия <Icon name="arrowRight" size={18} />
          </Link>
        </section>
      )}

      {tips.length > 0 && (
        <section className="tips" aria-label="Новости и подсказки">
          {tips.map((t) => (
            <div key={t.id} className="card tip">
              <span className="tile-icon">
                <Icon name={t.icon} size={20} />
              </span>
              <p>{t.text}</p>
              {t.to && (
                <Link to={t.to} className="link-btn link-btn--red">
                  {t.link} <Icon name="arrowRight" size={14} />
                </Link>
              )}
            </div>
          ))}
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
          {others.map((a) => {
            const t = termsOf(a);
            return (
              <button key={a.id} type="button" className="mini-list__row" onClick={() => open(a)}>
                <div>
                  <strong>
                    {goalById(a.goalId).title} <UnreadBadge app={a} />
                  </strong>
                  <span>
                    № {a.id} · {rub(t.amount)} · {months(t.term)}
                  </span>
                </div>
                <ClientStatusBadge app={a} />
              </button>
            );
          })}
        </section>

        {company && (
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
                <dt>{company.form === 'ИП' ? 'ОГРНИП' : 'ОГРН'}</dt>
                <dd>{maskTail(company.ogrn)}</dd>
              </div>
            </dl>
            <Link to="/profile" className="link-btn">
              Подробнее о компании <Icon name="arrowRight" size={16} />
            </Link>
          </section>
        )}
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
