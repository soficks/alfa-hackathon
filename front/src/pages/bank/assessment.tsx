import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { api } from '../../api';
import { POLICY } from '../../config/policy';
import { LEVEL_TITLE, codeInfo, type CodeLevel } from '../../config/routeCodes';
import type { Application, Grade, Metrics, Scoring } from '../../domain/types';
import { useAction, useUser } from '../../store/data';
import { dateTime, percent, ratio, rub } from '../../utils/format';
import { GRADE_RANGE, gradeTone } from './common';

/**
 * Блоки оценки клиента в карточке сотрудника. Ничего не считают — только показывают
 * результат расчёта из application.scoring / metrics / route / trace.
 */

const SCALE_MIN = 300;
const SCALE_MAX = 660;
const pos = (score: number) => `${(Math.min(SCALE_MAX, Math.max(SCALE_MIN, score)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100}%`;

/** Отрезки групп на шкале 300–660 */
const GRADE_SEGMENTS: { grade: Grade; from: number; to: number }[] = [
  { grade: 'E', from: 300, to: 550 },
  { grade: 'D', from: 550, to: 580 },
  { grade: 'C', from: 580, to: 610 },
  { grade: 'B', from: 610, to: 640 },
  { grade: 'A', from: 640, to: 660 },
];

export function GradeScale({ score }: { score: number }) {
  return (
    <div className="grade-scale" aria-label={`Балл ${score} на шкале 300–660`}>
      <div className="grade-scale__bar">
        {GRADE_SEGMENTS.map((s) => (
          <span
            key={s.grade}
            className={`grade-scale__seg grade-scale__seg--${gradeTone(s.grade)}`}
            style={{ width: `${((s.to - s.from) / (SCALE_MAX - SCALE_MIN)) * 100}%` }}
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
        {[300, 550, 580, 610, 640, 660].map((t) => (
          <span key={t} style={{ left: pos(t) }}>
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
  const at = (x: number) => `${(Math.min(max, Math.max(0, x)) / max) * 100}%`;
  let prev = 0;
  return (
    <div className="th-scale" aria-hidden="true">
      <div className="th-scale__bar">
        {zones.map(([to, zone]) => {
          const width = ((Math.min(to, max) - prev) / max) * 100;
          prev = Math.min(to, max);
          return <span key={to} className={`th-scale__seg th-scale__seg--${zone}`} style={{ width: `${width}%` }} />;
        })}
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
          scale={<GradeScale score={scoring.score} />}
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

export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return [on, () => setOn((v) => !v)] as const;
}
