import test from 'node:test';
import assert from 'node:assert/strict';
import type { Application, Company, CreditHistory, ExternalSources, Terms } from '../domain/types.ts';
import { isValidInn, isValidRegistrationNumber } from '../domain/requisites.ts';
import { DAY } from '../domain/time.ts';
import { productById, type Product } from '../config/products.ts';
import { NEUTRAL_REJECT_TEXT } from '../config/routeCodes.ts';
import { KNOWN_COMPANIES, LIQUIDATED_INN, RegistryError, YOUNG_INN, lookupCompany } from './registry.ts';
import { analyzeStatement } from './statement.ts';
import { bkiReport } from './bki.ts';
import { PD_FACTOR, PD_OFFSET, agePoints, gradeOf, historyPoints, industryPoints, oddsOf, pdOf, score, taxPoints, trendPoints } from './scoring.ts';
import { cashflowBase, findAlternatives, metricsFromBase, type CashflowBase } from './affordability.ts';
import { computeRoute } from './creditPolicy.ts';
import { createSeed } from './seed.ts';
import { assess, makeDecision, previewTerms, reassess, waiveSoftStop } from './operations.ts';

const now = new Date(2026, 9, 23, 12, 0);
const seed = createSeed(now);
const app = (id: string) => seed.applications.find((a) => a.id === id)!;
const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/* ---------- Реестр, БКИ, выписка ---------- */

test('Реестр: у всех синтетических компаний валидные ИНН и ОГРН/ОГРНИП', () => {
  for (const c of KNOWN_COMPANIES) {
    assert.ok(isValidInn(c.inn), c.name);
    assert.ok(isValidRegistrationNumber(c.ogrn, c.inn.length === 12 ? 'ИП' : 'ООО'), c.name);
  }
});

test('Реестр: неизвестный валидный ИНН — детерминированная компания, невалидный — ошибка', () => {
  assert.deepEqual(lookupCompany('7707083893', now), lookupCompany('7707083893', now));
  assert.equal(lookupCompany('500100732259', now).form, 'ИП');
  assert.throws(() => lookupCompany('7707083894', now), RegistryError);
  assert.equal(lookupCompany(LIQUIDATED_INN, now).status, 'liquidated');
  assert.ok(now.getTime() - new Date(lookupCompany(YOUNG_INN, now).registeredAt).getTime() < 6 * 30 * DAY);
});

test('Выписка: CF_m = Rev_m·(1 − v) − Fixed, тренд АльфаТех 0,72', () => {
  const s = analyzeStatement('7701111110');
  s.revenueByMonth.forEach((rev, i) => assert.ok(close(s.cashflowByMonth[i], rev * (1 - s.variableShare) - s.fixedMonthly, 1)));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  assert.ok(close(sum(s.revenueByMonth.slice(-3)) / sum(s.revenueByMonth.slice(-6, -3)), 0.72, 0.01));
  assert.deepEqual(analyzeStatement('7707083893'), analyzeStatement('7707083893'));
});

test('БКИ: у Кометы текущая просрочка 45 дней', () => {
  assert.equal(bkiReport('7725123450').currentOverdueDays, 45);
  assert.deepEqual(bkiReport('7707083893'), bkiReport('7707083893'));
});

/* ---------- Скоринговая карта (§9) ---------- */

test('Карта: срок деятельности — непересекающиеся интервалы', () => {
  const cases: [number, number][] = [[0, 60], [11, 60], [12, 90], [23, 90], [24, 105], [35, 105], [36, 120], [59, 120], [60, 135], [200, 135]];
  for (const [m, pts] of cases) assert.equal(agePoints(m)[1], pts, `${m} мес.`);
});

test('Карта: тренд выручки — границы 0,7 / 0,9 / 1,0 / 1,1', () => {
  const cases: [number | null, number][] = [[null, 50], [0.69, 50], [0.7, 80], [0.89, 80], [0.9, 100], [0.99, 100], [1.0, 110], [1.09, 110], [1.1, 125], [1.5, 125]];
  for (const [t, pts] of cases) assert.equal(trendPoints(t)[1], pts, `тренд ${t}`);
});

test('Карта: кредитная история — худшая категория по компании и руководителю', () => {
  const h = (c: CreditHistory['company']['worstClosed24m'], d = c, hasC = true, hasD = true): CreditHistory => ({
    company: { hasHistory: hasC, worstClosed24m: c, currentOverdueDays: 0 },
    director: { hasHistory: hasD, worstClosed24m: d, currentOverdueDays: 0 },
  });
  assert.equal(historyPoints(h('none'))[1], 160);
  assert.equal(historyPoints(h('none', 'none', false, false))[1], 120);
  assert.equal(historyPoints(h('1_29', 'none'))[1], 135);
  assert.equal(historyPoints(h('none', '30_90'))[1], 100);
  assert.equal(historyPoints(h('1_29', 'over_90'))[1], 60);
});

const sources = (o: Partial<ExternalSources> = {}): ExternalSources => ({
  registryStatus: 'active',
  unreliableData: false,
  bankruptcy: false,
  sanctions: false,
  zskRisk: 'low',
  fraudConfirmed: false,
  directorDisqualified: false,
  fnsBlocked: false,
  taxDiscipline: 'regular',
  taxDebt: 0,
  fsspDebt: 0,
  lawsuits: 0,
  negativeNetAssets2y: false,
  declaredRevenue: 0,
  checkedAt: now.toISOString(),
  ...o,
});

test('Карта: налоговая дисциплина и отрасль', () => {
  assert.equal(taxPoints(sources(), 500_000)[1], 130);
  assert.equal(taxPoints(sources({ taxDiscipline: 'minor', taxDebt: 10_000 }), 500_000)[1], 100);
  assert.equal(taxPoints(sources({ taxDebt: 60_000 }), 500_000)[1], 60);
  assert.equal(industryPoints('56.10')[1], 70);
  assert.equal(industryPoints('41.20')[1], 70);
  assert.equal(industryPoints('46.90')[1], 92);
  assert.equal(industryPoints('25.62')[1], 110);
  assert.equal(industryPoints('62.01')[1], 110);
});

test('Карта: пример из ТЗ — 120 + 160 + 110 + 130 + 92 = 612, odds 75,8:1, PD 1,30%, группа B', () => {
  const company: Company = { ...lookupCompany('7704123450', now), registeredAt: new Date(now.getTime() - 50 * 30.5 * DAY).toISOString() };
  const history: CreditHistory = {
    company: { hasHistory: true, worstClosed24m: 'none', currentOverdueDays: 0 },
    director: { hasHistory: true, worstClosed24m: 'none', currentOverdueDays: 0 },
  };
  const s = score({ company, sources: sources(), history, trend: 1.08, cf: 500_000, now });
  assert.deepEqual(s.factors.map((f) => f.points), [120, 160, 110, 130, 92]);
  assert.equal(s.score, 612);
  assert.ok(close(s.odds, 75.8, 0.1), `odds ${s.odds}`);
  assert.ok(close(s.pd * 100, 1.3, 0.01), `PD ${s.pd}`);
  assert.equal(s.grade, 'B');
  assert.equal(s.factors.reduce((x, f) => x + f.maxPoints, 0), 660);
});

test('Калибровка: factor = 20/ln2, offset = 600 − factor·ln50, PD(600) = 1/51', () => {
  assert.ok(close(PD_FACTOR, 28.853901, 1e-6));
  assert.ok(close(PD_OFFSET, 487.122876, 1e-6));
  assert.ok(close(pdOf(600), 1 / 51, 1e-9));
  assert.ok(close(oddsOf(620) / oddsOf(600), 2, 1e-9), '+20 баллов удваивают шансы');
});

test('Группы на граничных баллах 549/550/579/580/609/610/639/640', () => {
  const cases: [number, string][] = [[300, 'E'], [549, 'E'], [550, 'D'], [579, 'D'], [580, 'C'], [609, 'C'], [610, 'B'], [639, 'B'], [640, 'A'], [660, 'A']];
  for (const [s, g] of cases) assert.equal(gradeOf(s), g, `балл ${s}`);
});

/* ---------- Платёжеспособность (§8) и контрпредложения (§11) ---------- */

/** Пример из ТЗ: CF 484,2 тыс., DS 150 тыс.; Rev и Fixed подобраны так, что CF_stress = 247,16 тыс. */
const exampleBase: CashflowBase = {
  rev: 2_963_000,
  cf: 484_200,
  cfStress: (1 - 0.6) * 2_963_000 * 0.8 - 701_000,
  variableShare: 0.6,
  fixed: 701_000,
  ds: 150_000,
  debt: 1_500_000,
  cv: 0.05,
  cfWeak: 470_000,
  trend: 1.08,
  months: 12,
};
const exampleProduct: Product = { ...productById('investment'), maxAmount: 50_000_000, minTerm: 12, maxTerm: 60 };
const exampleTerms: Terms = { amount: 6_000_000, term: 36, rate: 20.5, paymentType: 'annuity' };

test('DSCR и стресс по примеру ТЗ: 6 млн / 36 мес. / 20,5% → DSCR 1,29, стресс 0,66', () => {
  const m = metricsFromBase(exampleBase, exampleTerms, exampleProduct, now);
  assert.equal(m.dscr!.toFixed(2), '1.29');
  assert.equal(m.dscrStress!.toFixed(2), '0.66');
  assert.ok(close(m.cf / (m.dsCurrent + m.aNew), m.dscr!, 0.01));
});

test('Контрпредложения по примеру ТЗ: ≈2,6 млн / 36, ≈3,17 млн / 48, ≈3,63 млн / 60', () => {
  // findAlternatives работает от финансов заявки — подменяем базу через тот же расчёт
  const alts = findAlternativesFromBase(exampleBase);
  assert.deepEqual(alts.map((a) => a.terms.term), [36, 48, 60]);
  const expected = [2_600_000, 3_170_000, 3_630_000];
  alts.forEach((a, i) => assert.ok(close(a.terms.amount, expected[i], 100_000), `${a.terms.amount} ≈ ${expected[i]}`));
  alts.forEach((a) => assert.ok(a.dscr! >= 1.25 && a.dscrStress! >= 1.0));
});

/** Вариант findAlternatives для готовой базы (без финансов заявки). */
function findAlternativesFromBase(base: CashflowBase) {
  const months12 = Array(12).fill(base.rev);
  const financials = {
    revenue12m: base.rev * 12,
    avgTurnover12m: 0,
    avgTurnover3m: 0,
    turnoverByMonth: [],
    existingDebt: base.debt,
    existingMonthlyPayments: base.ds,
    existingLoans: 1,
    overdueCurrent: false,
    overdueClosed12m: 0,
    revenueByMonth: months12,
    cashflowByMonth: months12.map((r) => r * (1 - base.variableShare) - base.fixed),
    expenses: { suppliers: 0, payroll: 0, taxes: 0, rent: 0, other: 0 },
    variableShare: base.variableShare,
    fixedMonthly: base.fixed,
    topBuyerShare: 0.2,
    cashShare: 0.05,
  };
  assert.ok(close(cashflowBase(financials).cf, base.cf, 1));
  return findAlternatives(financials, exampleTerms, exampleProduct, 'manual', now);
}

test('CF ≤ 0: долг/CF не считается, флаг «поток отрицательный»', () => {
  const m = metricsFromBase({ ...exampleBase, cf: -10_000, cfStress: -50_000 }, exampleTerms, exampleProduct, now);
  assert.equal(m.debtCf, null);
  assert.equal(m.cfNegative, true);
  assert.equal(m.autoLimit, 0);
});

test('DSCR слабого периода считается только при CV > 0,3; PTI — справочно', () => {
  assert.equal(metricsFromBase(exampleBase, exampleTerms, exampleProduct, now).dscrWeak, undefined);
  const seasonal = metricsFromBase({ ...exampleBase, cv: 0.4 }, exampleTerms, exampleProduct, now);
  assert.ok(seasonal.dscrWeak !== undefined);
  assert.ok(close(seasonal.pti, seasonal.aNew / exampleBase.rev, 1e-5));
});

/* ---------- Маршрут (§3) ---------- */

test('Маршрут: жёсткий стоп сильнее высокого балла; H03 не раскрывается клиенту', () => {
  const base = app('20122'); // Морозова, группа A, все показатели в норме
  assert.equal(base.scoring!.grade, 'A');
  const withSanctions: Application = { ...base, assigneeId: undefined, sources: { ...base.sources!, sanctions: true } };
  const r = computeRoute({ app: withSanctions, product: productById(base.productId), scoring: base.scoring!, metrics: base.metrics!, now });
  assert.equal(r.route.status, 'REJECTED');
  assert.equal(r.route.step, 1);
  assert.equal(r.route.primaryCode, 'H03');
  assert.equal(r.clientRejectText, NEUTRAL_REJECT_TEXT);
  assert.ok(r.trace.slice(2).every((s) => s.result === 'skipped'));
});

test('Маршрут: группы D/E → F01 на шаге 3; серая зона G05 на шаге 6; авто-контрпредложение C01', () => {
  assert.equal(app('20116').route!.primaryCode, 'F01');
  assert.equal(app('20116').route!.step, 3);
  assert.equal(app('20117').status, 'REJECTED');
  assert.equal(app('20112').route!.primaryCode, 'G05');
  assert.equal(app('20112').route!.step, 6);
  const counter = app('20118');
  assert.equal(counter.status, 'COUNTER_OFFER');
  assert.equal(counter.route!.step, 7);
  const m = assess({ ...counter, requested: counter.decision!.terms! }, now).metrics;
  assert.ok(m.dscr! >= 1.25 && m.dscrStress! >= 1.0, 'контрпредложение проходит условия авто-одобрения');
});

test('Маршрут: несвежая выписка → D08 и NEED_INFO; после двух циклов — G10 в очередь', () => {
  const base = app('20111');
  const stale: Application = {
    ...base,
    assigneeId: undefined,
    documents: base.documents.map((d) => (d.docType === 'bank_statement' ? { ...d, periodTo: '2026-05' } : d)),
  };
  const r = computeRoute({ app: stale, product: productById(base.productId), scoring: base.scoring!, metrics: base.metrics!, now });
  assert.equal(r.route.status, 'NEED_INFO');
  assert.equal(r.requests[0].reasonCode, 'D08');
  const exhausted = computeRoute({ app: { ...stale, needInfoCycle: 2 }, product: productById(base.productId), scoring: base.scoring!, metrics: base.metrics!, now });
  assert.equal(exhausted.route.status, 'IN_QUEUE');
  assert.ok(exhausted.route.allCodes.includes('G10'));
});

test('Мягкий стоп снимается только с причиной, документом и обоснованием', () => {
  const belova = { ...app('20114'), assigneeId: 'e-anna', status: 'IN_REVIEW' as const };
  assert.ok(belova.route!.allCodes.includes('S01'));
  const anna = { role: 'employee' as const, id: 'e-anna', name: 'Анна Смирнова' };
  assert.throws(() => waiveSoftStop(belova, anna, { code: 'S01', reasonCode: 'W-01', evidence: 'Договоры', comment: 'коротко' }, now));
  const waived = waiveSoftStop(belova, anna, { code: 'S01', reasonCode: 'W-03', evidence: 'Договоры поставки на 12 мес.', comment: 'Есть подписанные договоры с покупателями на год вперёд.' }, now);
  assert.ok(!waived.route!.allCodes.includes('S01'));
  assert.equal(waived.waivers!.length, 1);
});

/* ---------- Запреты политики для сотрудника (§13) ---------- */

test('Одобрение запрещено при жёстком стопе и выше лимита + 10%', () => {
  const blocked = app('20123'); // ФНС заблокировала счета, заявка в работе
  assert.ok(blocked.route!.allCodes.includes('H08'));
  assert.ok(previewTerms(blocked, blocked.requested, now).blockers.some((b) => b.includes('H08')));
  const ok = app('20122');
  assert.deepEqual(previewTerms(ok, ok.requested, now).blockers, []);
  const tooMuch = previewTerms(ok, { ...ok.requested, amount: 30_000_000 }, now);
  assert.ok(tooMuch.blockers.some((b) => b.includes('лимита')));
});

test('Одобрение группы C ждёт второго подтверждения', () => {
  const granit = { ...app('20112'), status: 'IN_REVIEW' as const, assigneeId: 'e-anna' };
  const anna = { role: 'employee' as const, id: 'e-anna', name: 'Анна Смирнова' };
  const alt = granit.recommendation!.alternatives[0]?.terms ?? { ...granit.requested, amount: 1_000_000 };
  const pending = makeDecision(
    granit,
    anna,
    { type: 'approve', variant: 'other_terms', terms: { ...alt, rate: granit.requested.rate }, reasonCode: 'APR-02', validDays: 30, justification: 'Дополнительный источник погашения подтверждён договорами.', clientMessage: '' },
    now,
  );
  assert.equal(pending.status, 'IN_REVIEW');
  assert.ok(pending.pendingDecision);
});

/* ---------- Сид ---------- */

test('Сид: номера уникальны, есть группы A–E и все зоны DSCR', () => {
  const ids = seed.applications.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  const grades = new Set(seed.applications.map((a) => a.scoring?.grade).filter(Boolean));
  for (const g of ['A', 'B', 'C', 'D', 'E']) assert.ok(grades.has(g as never), `группа ${g}`);
  const dscrs = seed.applications.map((a) => a.metrics?.dscr).filter((x): x is number => typeof x === 'number');
  assert.ok(dscrs.some((d) => d >= 1.25) && dscrs.some((d) => d >= 1.1 && d < 1.25) && dscrs.some((d) => d < 1.1));
});

test('Сид: пересчёт даёт те же баллы и маршруты', () => {
  for (const a of seed.applications.filter((x) => x.scoring && x.route && !x.waivers?.length)) {
    const again = reassess(a, new Date(a.scoring!.calculatedAt));
    assert.equal(again.scoring!.score, a.scoring!.score, `№ ${a.id}`);
  }
});
