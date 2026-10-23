import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmployeeStatusBadge } from '../../components/StatusBadge';
import { DocList, DocPreview } from '../../components/Docs';
import { HistoryList, MessagesThread } from '../../components/Thread';
import { ScheduleModal } from '../../components/Schedule';
import type { BankSection } from '../../components/Layout';
import { api } from '../../api';
import { DOC_TYPES } from '../../config/docTypes';
import { goalById, productById, subgoalTitle } from '../../config/products';
import { PAYMENT_TYPE_LABEL, calculateSchedule } from '../../domain/finance';
import { unreadForEmployee } from '../../domain/alerts';
import { canMessage, isFinal } from '../../domain/stateMachine';
import { monthsBetween } from '../../domain/time';
import type { Application, CheckResult, DocFile } from '../../domain/types';
import { useAction, useApplication, useUser, useUserName } from '../../store/data';
import { businessAge, compactRub, dateTime, months, percent, ratio, rub } from '../../utils/format';
import { RejectModal, RequestDocsModal, DecisionModal } from './modals';
import { mainPayment, missingDocTypes } from './derive';
import { AssessmentCards, ScoringTab } from './assessment';

type Tab = 'overview' | 'docs' | 'scoring' | 'messages' | 'history';

const SECTION_LABEL: Record<BankSection, [string, string]> = {
  queue: ['Заявки', '/bank/queue'],
  my: ['Мои проверки', '/bank/my'],
  history: ['История', '/bank/history'],
};

export default function BankApplicationPage() {
  const { id } = useParams();
  const user = useUser();
  const nameOf = useUserName();
  const app = useApplication(id);
  const section = useOutletContext<BankSection | undefined>() ?? 'queue';
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [modal, setModal] = useState<'request' | 'reject' | 'decision' | 'schedule' | null>(null);
  const [preview, setPreview] = useState<DocFile | null>(null);
  const take = useAction();
  const ack = useAction();

  const mine = app?.assigneeId === user.id;

  // Открыли сообщения — прочитаны; открыли документы — «новые документы» просмотрены
  useEffect(() => {
    if (!app || !mine) return;
    if (tab === 'messages') api.applications.markSeen(app.id, user.id);
    if (tab === 'docs') api.applications.clearNewDocs(app.id, user.id);
  }, [tab, app?.id, app?.messages.length, mine, user.id]);

  if (!app) return <Navigate to="/bank/queue" replace />;

  const product = productById(app.productId);
  const goal = goalById(app.goalId);
  const final = isFinal(app.status);
  const canDecide = mine && app.status === 'IN_REVIEW';
  const unread = unreadForEmployee(app);
  const [crumbLabel, crumbTo] = SECTION_LABEL[section];
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true, state: location.state });

  return (
    <div className="bank-card">
      <nav className="crumbs" aria-label="Хлебные крошки">
        <Link to={crumbTo}>{crumbLabel}</Link>
        <span className="crumbs__slash">/</span>
        <span className="crumbs__current">№ {app.id}</span>
      </nav>

      <div className="bank-card__head">
        <div>
          <h1 className="page-title">{app.company.name}</h1>
          <p className="page-subtitle">
            ИНН {app.company.inn} · {product.name} · {goal.title}
            {app.subgoalId ? ` (${subgoalTitle(app.goalId, app.subgoalId)?.toLowerCase()})` : ''} · {PAYMENT_TYPE_LABEL[app.requested.paymentType].toLowerCase()} платёж
          </p>
          <EmployeeStatusBadge app={app} size="lg" />
        </div>
        <div className="bank-card__assign">
          {app.status === 'IN_QUEUE' && (
            <button type="button" className="btn btn--outline btn--lg" disabled={take.pending} onClick={() => take.run(() => api.applications.takeToWork(app.id, user.id))}>
              {take.pending ? 'Берём…' : 'Взять в работу'}
            </button>
          )}
          {mine && !final && app.assignedAt && (
            <span className="pill pill--ok">
              <Icon name="user" size={16} /> В работе у вас · взята {dateTime(app.assignedAt).toLowerCase()}
            </span>
          )}
          {app.assigneeId && !mine && !final && (
            <span className="pill">
              <Icon name="lock" size={16} /> Только просмотр: в работе — {nameOf(app.assigneeId)}
            </span>
          )}
          {final && (
            <span className="pill">
              <Icon name="lock" size={16} /> Заявка завершена — только просмотр
            </span>
          )}
          {take.error && <p className="form-error">{take.error}</p>}
        </div>
      </div>

      {app.changedSinceReview && (
        <div className="changed-banner" role="status">
          <Icon name="warning" size={20} />
          <div>
            <strong>Клиент изменил данные {app.changes.length ? dateTime(app.changes[app.changes.length - 1].at) : ''}</strong>
            <ul>
              {app.changes
                .filter((c) => c.version === app.version)
                .map((c) => (
                  <li key={`${c.field}-${c.at}`}>
                    {CHANGE_LABEL[c.field] ?? c.field}: {c.from} → <strong>{c.to}</strong>
                  </li>
                ))}
            </ul>
            <p className="micro">
              Оценка пересчитана автоматически: группа {app.scoring?.grade}, {app.scoring?.score} из 660.
            </p>
          </div>
          {mine && (
            <button type="button" className="btn btn--outline btn--sm" disabled={ack.pending} onClick={() => ack.run(() => api.applications.acknowledgeChanges(app.id, user.id))}>
              Ознакомлен(а)
            </button>
          )}
        </div>
      )}

      <div className="tabs" role="tablist">
        {(
          [
            ['overview', 'Обзор', undefined],
            ['docs', 'Документы', app.documents.length],
            ['scoring', 'Скоринг', undefined],
            ['messages', 'Сообщения', unread || undefined],
            ['history', 'История', app.history.length],
          ] as [Tab, string, number | undefined][]
        ).map(([t, label, count]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tabs__tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {label}
            {count !== undefined && <span className={`tabs__count${t === 'messages' ? ' tabs__count--alert' : ''}`}>{count}</span>}
            {t === 'docs' && app.newDocsForEmployee && <span className="dot-new" aria-label="новые документы" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview app={app} onTab={setTab} onPreview={setPreview} onSchedule={() => setModal('schedule')} />}
      {tab === 'docs' && <DocsTab app={app} onPreview={setPreview} />}
      {tab === 'scoring' && <ScoringTab app={app} canRescore={mine && !final} />}
      {tab === 'messages' && (
        <section className="card">
          <h2 className="card-title">Переписка с клиентом</h2>
          <MessagesThread
            app={app}
            canWrite={mine && canMessage(app.status)}
            hint={!canMessage(app.status) ? 'Переписка закрыта.' : !mine ? 'Писать клиенту может только специалист, у которого заявка в работе.' : undefined}
          />
        </section>
      )}
      {tab === 'history' && (
        <section className="card">
          <h2 className="card-title">История · все события</h2>
          <HistoryList events={app.history} role="employee" />
        </section>
      )}

      <div className="action-bar">
        <span className="action-bar__id">№ {app.id}</span>
        {!canDecide && !final && <span className="action-bar__hint">{app.status === 'IN_QUEUE' ? 'Возьмите заявку в работу, чтобы принять решение' : mine ? 'Ждём клиента — решение будет доступно после ответа' : 'Решение принимает назначенный специалист'}</span>}
        <button type="button" className="btn btn--outline" disabled={!canDecide} onClick={() => setModal('request')}>
          Запросить документы
        </button>
        <button type="button" className="btn btn--outline" disabled={!canDecide} onClick={() => setModal('reject')}>
          Отказать
        </button>
        <button type="button" className="btn btn--primary" disabled={!canDecide} onClick={() => setModal('decision')}>
          Перейти к решению
        </button>
      </div>

      {modal === 'request' && <RequestDocsModal app={app} onClose={() => setModal(null)} />}
      {modal === 'reject' && <RejectModal app={app} onClose={() => setModal(null)} />}
      {modal === 'decision' && <DecisionModal app={app} onClose={() => setModal(null)} />}
      {modal === 'schedule' && <ScheduleModal terms={app.decision?.terms ?? app.requested} onClose={() => setModal(null)} />}
      {preview && <DocPreview doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  amount: 'Сумма',
  term: 'Срок',
  paymentType: 'Тип платежа',
  graceMonths: 'Отсрочка',
  revenue12m: 'Выручка за 12 мес.',
  existingDebt: 'Долг по кредитам',
  existingMonthlyPayments: 'Платежи по кредитам',
};

/* ---------- Обзор ---------- */

function ratioTone(value: number, ok: number, warn: number) {
  return value <= ok ? 'ok' : value <= warn ? 'warn' : 'fail';
}

function Overview({ app, onTab, onPreview, onSchedule }: { app: Application; onTab: (t: Tab) => void; onPreview: (d: DocFile) => void; onSchedule: () => void }) {
  const f = app.financials;
  const t = app.requested;
  const s = calculateSchedule(t);
  const pay = mainPayment(app);
  const age = monthsBetween(new Date(app.company.registeredAt), new Date());
  const debtLoad = f && f.revenue12m ? (f.existingDebt + t.amount) / f.revenue12m : 0;
  const payShare = f && f.avgTurnover3m ? s.maxPayment / f.avgTurnover3m : 0;
  const change = f && f.avgTurnover12m ? f.avgTurnover3m / f.avgTurnover12m - 1 : 0;
  const statement = app.documents.find((d) => d.docType === 'bank_statement');

  return (
    <div className="bank-grid">
      <div className="bank-grid__main">
        <AssessmentCards scoring={app.scoring} metrics={app.metrics} />

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Параметры заявки</h2>
            <button type="button" className="link-btn" onClick={onSchedule}>
              <Icon name="calendar" size={16} /> График
            </button>
          </div>
          <dl className="conditions">
            <div>
              <dt>Сумма</dt>
              <dd>{rub(t.amount)}</dd>
            </div>
            <div>
              <dt>Срок</dt>
              <dd>{months(t.term)}</dd>
            </div>
            <div>
              <dt>Ставка (ориентир.)</dt>
              <dd>{t.rate}%</dd>
            </div>
            <div>
              <dt>Тип платежа</dt>
              <dd className="conditions__text">
                {PAYMENT_TYPE_LABEL[t.paymentType]}
                {t.graceMonths ? `, отсрочка ${t.graceMonths} мес.` : ''}
              </dd>
            </div>
            <div>
              <dt>{pay.label}</dt>
              <dd>{rub(pay.value)}</dd>
            </div>
            <div>
              <dt>Цель</dt>
              <dd className="conditions__text">
                {goalById(app.goalId).title}
                {app.subgoalId ? ` — ${subgoalTitle(app.goalId, app.subgoalId)?.toLowerCase()}` : ''}
              </dd>
            </div>
            <div>
              <dt>Подана</dt>
              <dd className="conditions__text">{app.submittedAt ? dateTime(app.submittedAt) : '—'}</dd>
            </div>
          </dl>
          {app.decision?.terms && <p className="micro">Решение: {rub(app.decision.terms.amount)}, {months(app.decision.terms.term)}, {app.decision.terms.rate}% — {app.decision.decidedBy}.</p>}
        </section>

        {f && (
          <section className="card">
            <h2 className="card-title">Компания и финансы</h2>
            <div className="fin-cards">
              <div className="fin-card">
                <span>Выручка за 12 мес.</span>
                <strong>{compactRub(f.revenue12m)}</strong>
              </div>
              <div className="fin-card">
                <span>Средний оборот за 12 мес.</span>
                <strong>{compactRub(f.avgTurnover12m)}</strong>
              </div>
              <div className="fin-card">
                <span>Средний оборот за 3 мес.</span>
                <strong>
                  {compactRub(f.avgTurnover3m)} <em className={change >= 0 ? 'up' : 'down'}>{`${change >= 0 ? '+' : '−'}${percent(Math.abs(change))}`}</em>
                </strong>
              </div>
              <div className="fin-card">
                <span>Срок работы (ЕГРЮЛ)</span>
                <strong>{businessAge(age)}</strong>
              </div>
              <div className="fin-card">
                <span>Обязательства (БКИ)</span>
                <strong>{compactRub(f.existingDebt)}</strong>
                <small>{rub(f.existingMonthlyPayments)} в месяц · кредитов: {f.existingLoans}</small>
              </div>
            </div>
            <Sparkline values={f.turnoverByMonth} />
            <div className="ratios">
              <div className={`ratio ratio--${ratioTone(debtLoad, 0.3, 0.6)}`}>
                <span>Долговая нагрузка</span>
                <strong>{percent(debtLoad)}</strong>
                <small>(обязательства + новый кредит) / выручка за 12 мес.</small>
              </div>
              <div className={`ratio ratio--${ratioTone(payShare, 0.2, 0.35)}`}>
                <span>Платёж / оборот за 3 мес.</span>
                <strong>{percent(payShare)}</strong>
                <small>максимальный платёж {rub(s.maxPayment)}</small>
              </div>
            </div>
          </section>
        )}

        <section className="card">
          <h2 className="card-title">Автоматические проверки</h2>
          <ul className="checks">
            {(['registry', 'sources', 'bki', 'requisites', 'documents'] as CheckResult['id'][]).map((cid) => {
              const c = app.checks.find((x) => x.id === cid);
              if (!c) return null;
              return (
                <li key={c.id} className={`check check--${c.status}`}>
                  <span className="check__icon">
                    <Icon name={c.status === 'ok' ? 'checkCircle' : c.status === 'warn' ? 'warning' : 'xCircle'} size={20} />
                  </span>
                  <div>
                    <strong>{c.title}</strong>
                    <ul>
                      {c.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <aside className="bank-grid__side">
        {app.recommendation && (
          <section className="card why">
            <h2 className="card-title">Рекомендация системы</h2>
            <p className={`recommend recommend--${app.recommendation.type}`}>
              <Icon name="sparkle" size={16} /> {app.recommendation.text}
            </p>
            {app.recommendation.alternatives.length > 0 && (
              <ul className="why__list">
                {app.recommendation.alternatives.map((x) => (
                  <li key={`${x.terms.amount}-${x.terms.term}`}>
                    <strong>
                      {rub(x.terms.amount)} на {months(x.terms.term)}:
                    </strong>{' '}
                    DSCR {ratio(x.dscr)}, стресс {ratio(x.dscrStress)}, платёж {rub(x.payment)}
                  </li>
                ))}
              </ul>
            )}
            {statement && (
              <button type="button" className="link-btn link-btn--blue" onClick={() => onPreview(statement)}>
                Открыть выписку по счёту <Icon name="arrowRight" size={14} />
              </button>
            )}
            {missingDocTypes(app).length > 0 && (
              <button type="button" className="link-btn link-btn--blue" onClick={() => onTab('docs')}>
                Не хватает: {missingDocTypes(app).map((t) => DOC_TYPES[t].short.toLowerCase()).join(', ')} <Icon name="arrowRight" size={14} />
              </button>
            )}
          </section>
        )}

        <section className="card">
          <h2 className="card-title">Прикреплённые документы</h2>
          <DocList docs={app.documents.slice(0, 3)} onOpen={onPreview} />
          <button type="button" className="link-btn link-btn--blue" onClick={() => onTab('docs')}>
            Все документы · {app.documents.length} <Icon name="arrowRight" size={14} />
          </button>
        </section>
      </aside>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values) * 0.9;
  const w = 100 / (values.length - 1);
  const pts = values.map((v, i) => `${(i * w).toFixed(2)},${(36 - ((v - min) / (max - min || 1)) * 32).toFixed(2)}`).join(' ');
  const monthsNames = values.map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (values.length - i));
    return d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  });
  return (
    <figure className="sparkline">
      <figcaption>Поступления на счёт по месяцам</figcaption>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Обороты за 12 месяцев: от ${rub(Math.min(...values))} до ${rub(max)}`}>
        <rect x={100 - 3 * w - w / 2} y="0" width={3 * w + w / 2} height="40" className="sparkline__recent" />
        <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sparkline__axis">
        {monthsNames.map((m, i) => (
          <span key={`${m}-${i}`}>{m}</span>
        ))}
      </div>
    </figure>
  );
}

/* ---------- Документы ---------- */

function DocsTab({ app, onPreview }: { app: Application; onPreview: (d: DocFile) => void }) {
  const product = productById(app.productId);
  return (
    <div className="bank-grid">
      <section className="card bank-grid__main">
        <h2 className="card-title">Документы клиента · {app.documents.length}</h2>
        <p className="muted form-note">Только файлы, которые загрузил клиент: при подаче или по запросу. Анкета компании — это данные на вкладке «Обзор».</p>
        <DocList docs={app.documents} onOpen={onPreview} showSource />
      </section>
      <aside className="card bank-grid__side">
        <h2 className="card-title">Комплектность: {product.name}</h2>
        <ul className="checks">
          {product.requiredDocs.map((t) => {
            const has = app.documents.some((d) => d.docType === t);
            return (
              <li key={t} className={`check check--${has ? 'ok' : 'warn'}`}>
                <span className="check__icon">
                  <Icon name={has ? 'checkCircle' : 'warning'} size={20} />
                </span>
                <div>
                  <strong>{DOC_TYPES[t].title}</strong>
                  <ul>
                    <li>{has ? 'Есть' : 'Нет — можно запросить у клиента'}</li>
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
        {app.docRequests.length > 0 && (
          <>
            <h3 className="form-label">Запросы клиенту</h3>
            <ul className="req-status">
              {app.docRequests.map((r) => (
                <li key={r.id}>
                  {DOC_TYPES[r.docType].title} — {r.fulfilledByDocId ? `получено ${dateTime(r.fulfilledAt ?? r.createdAt)}` : `ждём до ${dateTime(r.dueAt)}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
