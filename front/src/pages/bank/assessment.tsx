import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { api } from '../../api';
import { POLICY } from '../../config/policy';
import { LEVEL_TITLE, codeInfo, type CodeLevel } from '../../config/routeCodes';
import type { Application, Grade, Metrics, Route, Scoring, TraceStep } from '../../domain/types';
import { useAction, useUser } from '../../store/data';
import { dateTime, percent, ratio, rub } from '../../utils/format';
import { GRADE_RANGE, gradeTone } from './common';

/**
 * Блоки оценки клиента в карточке сотрудника. Ничего не считают — только показывают
 * результат расчёта из application.scoring / metrics / route / trace.
 */

/**
 * Кусочная шкала: отрезки между порогами одинаковой ширины, значение интерполируется
 * внутри своего отрезка. Так узкие зоны (550–580, 1,1–1,25) не схлопываются в карточке.
 */
function piecewise(points: number[]) {
  const n = points.length - 1;
  return (x: number) => {
    const v = Math.min(points[n], Math.max(points[0], x));
    let i = 0;
    while (i < n - 1 && v > points[i + 1]) i++;
    const span = points[i + 1] - points[i] || 1;
    return `${((i + (v - points[i]) / span) / n) * 100}%`;
  };
}

const GRADE_POINTS = [300, 550, 580, 610, 640, 660];
const pos = piecewise(GRADE_POINTS);

/** Отрезки групп на шкале 300–660 */
const GRADE_SEGMENTS: { grade: Grade; from: number; to: number }[] = [
  { grade: 'E', from: 300, to: 550 },
  { grade: 'D', from: 550, to: 580 },
  { grade: 'C', from: 580, to: 610 },
  { grade: 'B', from: 610, to: 640 },
  { grade: 'A', from: 640, to: 660 },
];

/** compact — в узкой карточке: без крайних подписей 300 и 660 */
export function GradeScale({ score, compact = false }: { score: number; compact?: boolean }) {
  return (
    <div className="grade-scale" aria-label={`Балл ${score} на шкале 300–660`}>
      <div className="grade-scale__bar">
        {GRADE_SEGMENTS.map((s) => (
          <span
            key={s.grade}
            className={`grade-scale__seg grade-scale__seg--${gradeTone(s.grade)}`}
            style={{ width: `${100 / GRADE_SEGMENTS.length}%` }}
            title={`Группа ${s.grade}: ${GRADE_RANGE[s.grade]}`}
          >
            {s.grade}
          </span>
        ))}
      </div>
      <span className="grade-scale__marker" style={{ left: pos(score) }}>
        <b>{score}</b>
      </span>
      <div className="grade-scale__ticks">
        {(compact ? GRADE_POINTS.slice(1, -1) : GRADE_POINTS).map((t) => (
          <span key={t} style={{ left: pos(t) }} data-edge={t === 300 ? 'start' : t === 660 ? 'end' : undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const pd = (x: number) => percent(x, 2);

/** Строка формулы: S = 120 + 160 + … = 612 → odds 75,8 : 1 → PD 1,30% → группа B */
export function ScoreFormula({ s }: { s: Scoring }) {
  return (
    <p className="formula">
      S = {s.factors.map((f) => f.points).join(' + ')} = <b>{s.score}</b> → odds {ratio(s.odds, 1)} : 1 → PD <b>{pd(s.pd)}</b> → группа <b>{s.grade}</b>
    </p>
  );
}

/* ---------- Вкладка «Скоринг» ---------- */

export function ScoringTab({ app, canRescore }: { app: Application; canRescore: boolean }) {
  const user = useUser();
  const { run, pending, error } = useAction();
  const s = app.scoring;
  if (!s) return <section className="card muted">Скоринг появится после авто-проверок.</section>;
  const stale = app.changes.some((c) => c.at > s.calculatedAt);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          Экспертная скоринговая карта · {s.score} из 660 · группа {s.grade}
        </h2>
        {canRescore && (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={!stale || pending}
            onClick={() => run(() => api.applications.rescore(app.id, user.id))}
            title={stale ? undefined : 'Данные не менялись с последнего расчёта'}
          >
            <Icon name="refresh" size={16} /> {pending ? 'Считаем…' : 'Пересчитать'}
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table factors">
          <thead>
            <tr>
              <th>Характеристика</th>
              <th>Значение клиента</th>
              <th>Категория карты</th>
              <th className="num">Очки / максимум</th>
            </tr>
          </thead>
          <tbody>
            {s.factors.map((f) => (
              <tr key={f.code}>
                <td>{f.title}</td>
                <td>{f.value}</td>
                <td className="muted">{f.category}</td>
                <td className="num">
                  <span className="fill-bar" aria-hidden="true">
                    <span style={{ width: `${(f.points / f.maxPoints) * 100}%` }} />
                  </span>
                  <b>{f.points}</b> / {f.maxPoints}
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={3}>Итог S — сумма пяти вкладов, без базовых баллов</td>
              <td className="num">
                <b>{s.score}</b> / 660
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ScoreFormula s={s} />
      <GradeScale score={s.score} />
      <p className="micro">
        factor = 20 / ln 2 = 28,85; offset = 600 − factor · ln 50 = 487,12; odds = exp((S − offset) / factor); PD = 1 / (1 + odds). Демонстрационная калибровка, не обучена на
        реальных данных. Рассчитан {dateTime(s.calculatedAt)}, политика {s.policyVersion}.{stale && ' Данные заявки менялись после расчёта.'}
      </p>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

/* ---------- Карточки «Оценка клиента» ---------- */

type Zone = 'ok' | 'warn' | 'fail';

/** Зона по порогам: выше good — зелёная, выше gray — жёлтая (для «меньше — лучше» — наоборот). */
function zoneOf(value: number | null, good: number, gray: number, lowerIsBetter = false): Zone {
  if (value === null) return lowerIsBetter ? 'fail' : 'ok';
  if (lowerIsBetter) return value <= good ? 'ok' : value <= gray ? 'warn' : 'fail';
  return value >= good ? 'ok' : value >= gray ? 'warn' : 'fail';
}

export const dscrZone = (v: number | null) => zoneOf(v, POLICY.DSCR_MIN, POLICY.DSCR_GRAY);
export const stressZone = (v: number | null) => zoneOf(v, POLICY.DSCR_STRESS_MIN, POLICY.DSCR_STRESS_GRAY);
export const debtCfZone = (v: number | null) => zoneOf(v, POLICY.DEBT_CF_OK, POLICY.DEBT_CF_MAX, true);

/** Мини-шкала с порогами и точкой клиента */
function ThresholdScale({ value, max, marks, zones }: { value: number | null; max: number; marks: number[]; zones: [number, Zone][] }) {
  const at = piecewise([0, ...marks, max]);
  return (
    <div className="th-scale" aria-hidden="true">
      <div className="th-scale__bar">
        {zones.map(([to, zone]) => (
          <span key={to} className={`th-scale__seg th-scale__seg--${zone}`} style={{ width: `${100 / zones.length}%` }} />
        ))}
      </div>
      {marks.map((m) => (
        <span key={m} className="th-scale__mark" style={{ left: at(m) }}>
          {ratio(m, m % 1 ? 2 : 0)}
        </span>
      ))}
      {value !== null && <span className="th-scale__dot" style={{ left: at(value) }} />}
    </div>
  );
}

function MetricCard({ title, zone, children, scale, note }: { title: string; zone: Zone; children: ReactNode; scale: ReactNode; note: string }) {
  return (
    <div className={`assess-card assess-card--${zone}`}>
      <span className="assess-card__title">{title}</span>
      <div className="assess-card__value">{children}</div>
      {scale}
      <span className="assess-card__note">{note}</span>
    </div>
  );
}

export function AssessmentCards({ scoring, metrics }: { scoring?: Scoring; metrics?: Metrics }) {
  if (!scoring || !metrics) return null;
  return (
    <section className="card assess">
      <h2 className="card-title">Оценка клиента</h2>
      <div className="assess__grid">
        <MetricCard
          title="Группа риска"
          zone={gradeTone(scoring.grade)}
          scale={<GradeScale score={scoring.score} compact />}
          note="PD — демонстрационная калибровка, не обучена на реальных данных"
        >
          <b className="assess-card__grade">{scoring.grade}</b>
          <span>
            {scoring.score} / 660 · PD {pd(scoring.pd)}
          </span>
        </MetricCard>
        <MetricCard
          title="DSCR"
          zone={dscrZone(metrics.dscr)}
          scale={<ThresholdScale value={metrics.dscr} max={2.5} marks={[1.1, 1.25]} zones={[[1.1, 'fail'], [1.25, 'warn'], [2.5, 'ok']]} />}
          note="≥ 1,25 норма · 1,1–1,25 пограничная · < 1,1 риск"
        >
          <b>{ratio(metrics.dscr)}</b>
        </MetricCard>
        <MetricCard
          title="DSCR при стрессе (−20% выручки)"
          zone={stressZone(metrics.dscrStress)}
          scale={<ThresholdScale value={metrics.dscrStress} max={2} marks={[0.9, 1]} zones={[[0.9, 'fail'], [1, 'warn'], [2, 'ok']]} />}
          note="≥ 1,0 норма · 0,9–1,0 пограничная · < 0,9 риск"
        >
          <b>{ratio(metrics.dscrStress)}</b>
        </MetricCard>
        <MetricCard
          title="Долг / CF"
          zone={debtCfZone(metrics.debtCf)}
          scale={<ThresholdScale value={metrics.debtCf} max={6} marks={[3, 4]} zones={[[3, 'ok'], [4, 'warn'], [6, 'fail']]} />}
          note="≤ 3 норма · 3–4 пограничная · > 4 риск"
        >
          <b>{metrics.cfNegative ? 'CF ≤ 0' : ratio(metrics.debtCf)}</b>
        </MetricCard>
      </div>
      <p className="micro">
        Доля платежа в выручке {percent(metrics.pti, 1)} (справочно, не используется в решении). Новый платёж {rub(metrics.aNew)}, текущие платежи {rub(metrics.dsCurrent)}.
      </p>
      {metrics.cfNegative && (
        <div className="notice notice--danger">
          <Icon name="xCircle" size={18} />
          Денежный поток отрицательный, кредит не обслуживается.
        </div>
      )}
    </section>
  );
}

/* ---------- Коды маршрута ---------- */

const LEVEL_TONE: Record<CodeLevel, Zone | 'info'> = { V: 'info', H: 'fail', D: 'info', F: 'fail', S: 'warn', G: 'warn', C: 'warn' };

export function CodeChip({ code, detail }: { code: string; detail?: string }) {
  const info = codeInfo(code);
  const tip = `${LEVEL_TITLE[info.level]} · ${info.title}${detail ? ` — ${detail}` : ''}${info.hint ? `. Проверить: ${info.hint.toLowerCase()}` : ''}`;
  return (
    <span className={`code-chip code-chip--${LEVEL_TONE[info.level]}`} title={tip} tabIndex={0} aria-label={`${code}: ${tip}`}>
      {code}
    </span>
  );
}

/* ---------- Ячейки таблиц очереди и «Моих проверок» ---------- */

/** DSCR с цветом зоны */
export function DscrCell({ app }: { app: Application }) {
  const m = app.metrics;
  if (!m) return <span className="muted">—</span>;
  const zone = m.cfNegative ? 'fail' : dscrZone(m.dscr);
  return (
    <span className={`grade-chip grade-chip--${zone}`} title={`DSCR ${ratio(m.dscr)}, при стрессе ${ratio(m.dscrStress)}`}>
      {m.cfNegative ? 'CF ≤ 0' : ratio(m.dscr)}
    </span>
  );
}

/** Основной код маршрута с подсказкой */
export function MainCodeCell({ app }: { app: Application }) {
  const r = app.route;
  if (!r?.primaryCode) return <span className="muted">—</span>;
  return <CodeChip code={r.primaryCode} detail={r.details[r.primaryCode]} />;
}

/** Шапка карточки: фраза маршрута и чипы всех кодов с подсказками */
export function RouteLine({ route }: { route?: Route }) {
  if (!route) return null;
  return (
    <div className="route-line">
      <span className="route-line__summary">{route.summary}</span>
      {route.allCodes.length > 0 && (
        <span className="route-line__codes">
          {route.allCodes.map((c) => (
            <CodeChip key={c} code={c} detail={route.details[c]} />
          ))}
        </span>
      )}
    </div>
  );
}

/* ---------- Вкладка «Деньги» ---------- */

interface MoneyRow {
  title: string;
  value: string;
  zone?: Zone;
  formula: string;
}

function moneyRows(m: Metrics, amount: number): MoneyRow[] {
  const rows: MoneyRow[] = [
    { title: 'Очищенная выручка, в месяц', value: rub(m.rev), formula: 'Rev = среднее за 12 мес. поступлений от покупателей без займов, переводов между своими счетами и возвратов' },
    { title: 'Доля переменных расходов v', value: percent(m.variableShare, 0), formula: 'v = (поставщики + прочие переменные) / Rev по выписке' },
    { title: 'Постоянные расходы Fixed, в месяц', value: rub(m.fixed), formula: 'Fixed = зарплата + налоги + аренда + прочие постоянные' },
    {
      title: 'Денежный поток CF, в месяц',
      value: rub(m.cf),
      zone: m.cfNegative ? 'fail' : 'ok',
      formula: `CF = Rev · (1 − v) − Fixed = ${rub(m.rev)} · ${ratio(1 - m.variableShare)} − ${rub(m.fixed)}`,
    },
    { title: 'Текущие платежи по кредитам', value: rub(m.dsCurrent), formula: 'DS = платежи по БКИ и выписке; если платежа нет — аннуитет остатка долга на 24 мес. под 20%' },
    { title: 'Платёж по новому кредиту', value: rub(m.aNew), formula: 'A_new — максимальный платёж по графику (у дифференцированного — первый, при отсрочке — платёж после неё)' },
    {
      title: 'DSCR',
      value: ratio(m.dscr),
      zone: dscrZone(m.dscr),
      formula: `DSCR = CF / (DS + A_new) = ${rub(m.cf)} / (${rub(m.dsCurrent)} + ${rub(m.aNew)}). Норма ≥ ${ratio(POLICY.DSCR_MIN)}, пограничная ${ratio(POLICY.DSCR_GRAY, 1)}–${ratio(POLICY.DSCR_MIN)}`,
    },
    {
      title: 'CF при стрессе',
      value: rub(m.cfStress),
      formula: `CF_stress = (1 − v) · Rev · (1 − ${percent(POLICY.STRESS_S)}) − Fixed — выручка падает, постоянные расходы остаются`,
    },
    {
      title: 'DSCR при стрессе',
      value: ratio(m.dscrStress),
      zone: stressZone(m.dscrStress),
      formula: `DSCR_stress = CF_stress / (DS + A_new) = ${rub(m.cfStress)} / ${rub(m.dsCurrent + m.aNew)}. Норма ≥ ${ratio(POLICY.DSCR_STRESS_MIN, 1)}, пограничная ${ratio(POLICY.DSCR_STRESS_GRAY, 1)}–${ratio(POLICY.DSCR_STRESS_MIN, 1)}`,
    },
    {
      title: 'Долг / CF',
      value: m.cfNegative ? 'не считается' : ratio(m.debtCf),
      zone: debtCfZone(m.debtCf),
      formula: m.cfNegative
        ? 'При CF ≤ 0 делить нельзя — платёжеспособность неустойчива'
        : `Долг / CF = (текущий долг + новый кредит) / (12 · CF) = (${rub(m.debtBalance)} + ${rub(amount)}) / (12 · ${rub(m.cf)}). Норма ≤ ${POLICY.DEBT_CF_OK}, пограничная ${POLICY.DEBT_CF_OK}–${POLICY.DEBT_CF_MAX}`,
    },
    {
      title: 'Тренд выручки',
      value: ratio(m.trend),
      zone: m.trend === null ? undefined : m.trend >= 1 ? 'ok' : m.trend >= POLICY.TREND_MIN ? 'warn' : 'fail',
      formula: `Тренд = выручка последних 3 мес. / предыдущих 3 мес. Ниже ${ratio(POLICY.TREND_MIN, 1)} — выручка падает (входит в скоринг)`,
    },
    {
      title: 'Сезонность (CV выручки)',
      value: ratio(m.cv),
      zone: m.cv > POLICY.CV_SEASONAL ? 'warn' : 'ok',
      formula: `CV = стандартное отклонение / среднее помесячной выручки. Выше ${ratio(POLICY.CV_SEASONAL, 1)} — считаем DSCR слабого периода`,
    },
  ];
  if (m.cfWeak !== undefined) {
    rows.push({
      title: 'DSCR слабого периода',
      value: ratio(m.dscrWeak ?? null),
      zone: m.dscrWeak === null || m.dscrWeak === undefined ? 'fail' : m.dscrWeak >= 1 ? 'ok' : 'fail',
      formula: `CF_weak = минимальный средний CF за 3 мес. подряд = ${rub(m.cfWeak)}; DSCR_weak = CF_weak / (DS + A_new). Ниже 1 — код G11`,
    });
  }
  rows.push(
    { title: 'Доля платежа в выручке (PTI)', value: percent(m.pti, 1), formula: 'PTI = A_new / Rev. Справочно, в решении не используется' },
    {
      title: 'Лимит авто-решения',
      value: rub(m.autoLimit),
      formula: `Наибольшая сумма на запрошенный срок, при которой DSCR ≥ ${ratio(POLICY.DSCR_MIN)}, стресс ≥ ${ratio(POLICY.DSCR_STRESS_MIN, 1)}, долг/CF ≤ ${POLICY.DEBT_CF_OK}; не больше ${percent(POLICY.K_REVENUE)} годовой выручки и полномочий системы`,
    },
    {
      title: 'Лимит ручного решения',
      value: rub(m.manualLimit),
      formula: `Та же формула с порогами пограничной зоны; сотрудник может одобрить до лимита + ${percent(POLICY.MANUAL_OVER_LIMIT)}`,
    },
  );
  return rows;
}

export function MoneyTab({ app }: { app: Application }) {
  const [open, setOpen] = useState<string | null>(null);
  const m = app.metrics;
  if (!m) return <section className="card muted">Расчёт денежного потока появится после авто-проверок.</section>;
  return (
    <section className="card">
      <h2 className="card-title">Деньги: денежный поток и нагрузка</h2>
      {m.cfNegative && (
        <div className="notice notice--danger">
          <Icon name="xCircle" size={18} />
          Денежный поток отрицательный ({rub(m.cf)} в месяц): кредит не обслуживается, долг/CF не считается.
        </div>
      )}
      <p className="muted form-note">
        Нажмите на строку, чтобы увидеть формулу с числами клиента. Условия: {rub(app.requested.amount)} на {app.requested.term} мес.
      </p>
      <div className="table-scroll">
        <table className="data-table money">
          <thead>
            <tr>
              <th>Показатель</th>
              <th className="num">Значение</th>
            </tr>
          </thead>
          <tbody>
            {moneyRows(m, app.requested.amount).map((r) => (
              <MoneyLine key={r.title} row={r} open={open === r.title} onToggle={() => setOpen(open === r.title ? null : r.title)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">Рассчитано {dateTime(m.calculatedAt)}.</p>
    </section>
  );
}

function MoneyLine({ row, open, onToggle }: { row: MoneyRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`money__row${open ? ' is-open' : ''}`}>
        <td>
          <button type="button" className="money__toggle" aria-expanded={open} onClick={onToggle}>
            <span className="money__caret" aria-hidden="true">
              ▸
            </span>
            {row.title}
          </button>
        </td>
        <td className="num">{row.zone ? <span className={`grade-chip grade-chip--${row.zone}`}>{row.value}</span> : row.value}</td>
      </tr>
      {open && (
        <tr className="money__formula">
          <td colSpan={2}>{row.formula}</td>
        </tr>
      )}
    </>
  );
}

/* ---------- Вкладка «Как принято решение» ---------- */

const STEP_MARK: Record<TraceStep['result'], string> = { pass: '✓', fired: '●', skipped: '' };
const STEP_HINT: Record<TraceStep['result'], string> = { pass: 'пройден', fired: 'сработал', skipped: 'не проверялся' };

export function DecisionTraceTab({ app }: { app: Application }) {
  const { route, trace } = app;
  if (!route || !trace?.length) return <section className="card muted">Маршрут появится после авто-проверок.</section>;
  const hard = route.allCodes.filter((c) => c.startsWith('H') || c === 'S01X');
  return (
    <section className="card">
      <h2 className="card-title">Как принято решение</h2>
      <p className="formula">{route.summary}</p>
      {hard.length > 0 && (
        <div className="notice notice--danger">
          <Icon name="xCircle" size={18} />
          Жёсткие стопы: {hard.join(', ')}. Проверяются все сразу, чтобы было видно каждое основание.
        </div>
      )}
      <ol className="trace">
        {trace.map((t) => (
          <li key={t.step} className={`trace__step trace__step--${t.result}`}>
            <span className="trace__mark" aria-label={STEP_HINT[t.result]}>
              {STEP_MARK[t.result] || t.step}
            </span>
            <div>
              <strong>
                Шаг {t.step}. {t.title}
              </strong>
              <span className="trace__hint"> · {STEP_HINT[t.result]}</span>
              {t.details && !t.codes.length && <p className="trace__details">{t.details}</p>}
              {t.codes.length > 0 && (
                <ul className="trace__codes">
                  {t.codes.map((c) => (
                    <li key={c}>
                      <CodeChip code={c} detail={route.details[c]} /> {codeInfo(c).title}
                      {route.details[c] ? ` — ${route.details[c]}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="micro">Шаги идут сверху вниз; первый сработавший шаг определяет маршрут. ✓ — пройден, ● — сработал, серым — не проверялся.</p>
    </section>
  );
}
