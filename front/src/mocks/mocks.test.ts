import test from 'node:test';
import assert from 'node:assert/strict';
import type { Company, DocFile, Financials, Terms } from '../domain/types.ts';
import { isValidInn, isValidRegistrationNumber } from '../domain/requisites.ts';
import { calculateSchedule } from '../domain/finance.ts';
import { DAY } from '../domain/time.ts';
import { productById } from '../config/products.ts';
import { KNOWN_COMPANIES, LIQUIDATED_INN, RegistryError, YOUNG_INN, lookupCompany } from './registry.ts';
import { analyzeStatement } from './statement.ts';
import { bkiReport } from './bki.ts';
import { BASE_SCORE, score, zoneOf } from './scoring.ts';
import { counterAmount, decide, rateFor } from './creditPolicy.ts';
import { createSeed } from './seed.ts';
import { prefillFinancials, runPipelineSync, submit } from './operations.ts';

const now = new Date(2026, 9, 23, 12, 0);

/* ---------- Реестр, БКИ, выписка ---------- */

test('Реестр: у всех синтетических компаний валидные ИНН и ОГРН/ОГРНИП', () => {
  for (const c of KNOWN_COMPANIES) {
    assert.ok(isValidInn(c.inn), c.name);
    assert.ok(isValidRegistrationNumber(c.ogrn, c.inn.length === 12 ? 'ИП' : 'ООО'), c.name);
  }
});

test('Реестр: неизвестный валидный ИНН — детерминированная компания, невалидный — ошибка', () => {
  const a = lookupCompany('7707083893', now);
  const b = lookupCompany('7707083893', now);
  assert.deepEqual(a, b);
  assert.ok(isValidRegistrationNumber(a.ogrn, a.form));
  assert.equal(lookupCompany('500100732259', now).form, 'ИП');
  assert.throws(() => lookupCompany('7707083894', now), RegistryError);
});

test('Реестр: Орион ликвидирован, Новиковой 4 месяца', () => {
  assert.equal(lookupCompany(LIQUIDATED_INN, now).status, 'liquidated');
  const young = lookupCompany(YOUNG_INN, now);
  assert.ok(now.getTime() - new Date(young.registeredAt).getTime() < 6 * 30 * DAY);
});

test('Выписка: у АльфаТех средний оборот за 3 мес на 25–30% ниже среднего за 12', () => {
  const s = analyzeStatement('7701111110');
  const change = s.avgTurnover3m / s.avgTurnover12m - 1;
  assert.ok(change <= -0.25 && change >= -0.3, `изменение ${change}`);
  assert.equal(s.turnoverByMonth.length, 12);
  assert.equal(s.revenue12m, s.turnoverByMonth.reduce((x, y) => x + y, 0));
  assert.deepEqual(analyzeStatement('7707083893'), analyzeStatement('7707083893'));
});

test('БКИ детерминирован, у Ориона текущая просрочка', () => {
  assert.deepEqual(bkiReport('7707083893'), bkiReport('7707083893'));
  assert.equal(bkiReport(LIQUIDATED_INN).overdueCurrent, true);
});

/* ---------- Скоринг ---------- */

const company = (ageMonths: number, status: Company['status'] = 'active'): Company => ({
  inn: '7707083893',
  ogrn: '1027700132195',
  form: 'ООО',
  name: 'ООО «Тест»',
  address: 'Москва',
  registeredAt: new Date(now.getTime() - ageMonths * 30.5 * DAY).toISOString(),
  okved: '46.90',
  okvedName: 'Торговля',
  status,
  head: 'Тестов Т. Т.',
});

const fin = (p: Partial<Financials> = {}): Financials => ({
  revenue12m: 36_000_000,
  avgTurnover12m: 3_000_000,
  avgTurnover3m: 3_000_000,
  turnoverByMonth: Array(12).fill(3_000_000),
  existingDebt: 0,
  existingMonthlyPayments: 0,
  existingLoans: 0,
  overdueCurrent: false,
  overdueClosed12m: 0,
  ...p,
});

const terms = (amount: number, term = 24, paymentType: Terms['paymentType'] = 'annuity'): Terms => ({ amount, term, rate: 21, paymentType });
const pointsOf = (s: ReturnType<typeof score>, id: string) => s.factors.find((f) => f.id === id)!.points;

test('Скоринг: база 500 и сумма факторов', () => {
  const s = score({ company: company(48), financials: fin(), terms: terms(2_000_000), now });
  assert.equal(s.base, BASE_SCORE);
  assert.equal(s.score, Math.min(1000, 500 + s.factors.reduce((x, f) => x + f.points, 0)));
  assert.equal(s.factors.length, 6);
  assert.ok(s.factors.every((f) => f.explanation.length > 10));
});

test('Скоринг: срок работы бизнеса', () => {
  assert.equal(pointsOf(score({ company: company(8), financials: fin(), terms: terms(1e6), now }), 'age'), -80);
  assert.equal(pointsOf(score({ company: company(24), financials: fin(), terms: terms(1e6), now }), 'age'), 0);
  assert.equal(pointsOf(score({ company: company(48), financials: fin(), terms: terms(1e6), now }), 'age'), 60);
});

test('Скоринг: платёж к обороту за 3 месяца, все четыре интервала', () => {
  // подбираем оборот так, чтобы доля платежа была 15%, 30%, 45% и 60%
  const p = calculateSchedule(terms(2_000_000)).maxPayment;
  const cases: [number, number][] = [
    [0.15, 120],
    [0.3, 40],
    [0.45, -60],
    [0.6, -150],
  ];
  for (const [share, pts] of cases) {
    const s = score({ company: company(48), financials: fin({ avgTurnover3m: p / share }), terms: terms(2_000_000), now });
    assert.equal(pointsOf(s, 'payment_to_turnover'), pts, `доля ${share}`);
  }
});

test('Скоринг: долговая нагрузка и сумма к выручке', () => {
  const t = (debt: number, amount: number) => score({ company: company(48), financials: fin({ existingDebt: debt }), terms: terms(amount), now });
  assert.equal(pointsOf(t(0, 9_000_000), 'debt_load'), 100); // 25%
  assert.equal(pointsOf(t(10_000_000, 9_000_000), 'debt_load'), 0); // 53%
  assert.equal(pointsOf(t(20_000_000, 9_000_000), 'debt_load'), -100); // 81%
  assert.equal(pointsOf(t(30_000_000, 9_000_000), 'debt_load'), -200); // 108%
  assert.equal(pointsOf(t(0, 9_000_000), 'amount_to_revenue'), 50);
  assert.equal(pointsOf(t(0, 12_000_000), 'amount_to_revenue'), 0);
  assert.equal(pointsOf(t(0, 20_000_000), 'amount_to_revenue'), -80);
});

test('Скоринг: кредитная история и динамика оборотов', () => {
  const s = (f: Partial<Financials>) => score({ company: company(48), financials: fin(f), terms: terms(1e6), now });
  assert.equal(pointsOf(s({ existingLoans: 2, existingDebt: 1e6 }), 'credit_history'), 80);
  assert.equal(pointsOf(s({}), 'credit_history'), 0);
  assert.equal(pointsOf(s({ overdueClosed12m: 1 }), 'credit_history'), -80);
  assert.equal(pointsOf(s({ overdueClosed12m: 3 }), 'credit_history'), -160);
  assert.equal(pointsOf(s({ avgTurnover3m: 3_400_000 }), 'turnover_dynamics'), 50);
  assert.equal(pointsOf(s({ avgTurnover3m: 2_900_000 }), 'turnover_dynamics'), 0);
  assert.equal(pointsOf(s({ avgTurnover3m: 2_400_000 }), 'turnover_dynamics'), -60);
  assert.equal(pointsOf(s({ avgTurnover3m: 2_000_000 }), 'turnover_dynamics'), -120);
});

test('Скоринг: зоны и ограничение 0–1000', () => {
  assert.equal(zoneOf(399), 'high_risk');
  assert.equal(zoneOf(400), 'manual');
  assert.equal(zoneOf(699), 'manual');
  assert.equal(zoneOf(700), 'auto');
  const worst = score({
    company: company(7),
    financials: fin({ avgTurnover3m: 100_000, existingDebt: 90_000_000, overdueClosed12m: 5 }),
    terms: terms(20_000_000),
    now,
  });
  assert.equal(worst.score, 0);
});

test('Скоринг: стоп-факторы', () => {
  assert.deepEqual(score({ company: company(48, 'liquidated'), financials: fin(), terms: terms(1e6), now }).stopFactors.map((s) => s.code), ['company_liquidated']);
  assert.deepEqual(score({ company: company(48), financials: fin({ overdueCurrent: true }), terms: terms(1e6), now }).stopFactors.map((s) => s.code), ['overdue_current']);
  assert.deepEqual(score({ company: company(4), financials: fin(), terms: terms(1e6), now }).stopFactors.map((s) => s.code), ['business_too_young']);
  assert.equal(score({ company: company(8), financials: fin(), terms: terms(1e6), now }).stopFactors.length, 0);
});

/* ---------- Кредитная логика ---------- */

const working = productById('working_capital');
const docs = (types: DocFile['docType'][]): DocFile[] =>
  types.map((t, i) => ({ id: String(i), name: t, size: 1, docType: t, addedAt: now.toISOString(), addedBy: 'client', source: 'submission' }));
const fullDocs = docs(['bank_statement', 'financial_statements']);

test('Кредитная логика: стоп-фактор → отказ', () => {
  const sc = score({ company: company(48, 'liquidated'), financials: fin(), terms: terms(1e6), now });
  const r = decide({ product: working, requested: terms(1e6), scoring: sc, documents: fullDocs, financials: fin() });
  assert.equal(r.outcome, 'REJECTED');
  assert.equal(r.reasonCode, 'company_liquidated');
});

test('Кредитная логика: авто-одобрение и ставка −1 п.п. при балле ≥ 800', () => {
  const f = fin({ existingLoans: 1, existingDebt: 500_000, avgTurnover3m: 3_400_000 });
  const sc = score({ company: company(48), financials: f, terms: terms(2_000_000), now });
  assert.ok(sc.score >= 800);
  const r = decide({ product: working, requested: terms(2_000_000), scoring: sc, documents: fullDocs, financials: f });
  assert.equal(r.outcome, 'APPROVED');
  assert.equal(r.terms!.rate, working.baseRate - 1);
  assert.equal(rateFor(working, 750), working.baseRate);
});

test('Кредитная логика: в очередь — сумма выше авто-лимита или нет документов', () => {
  const sc = score({ company: company(48), financials: fin(), terms: terms(3_500_000), now });
  const r = decide({ product: working, requested: terms(3_500_000), scoring: sc, documents: fullDocs, financials: fin() });
  assert.equal(r.outcome, 'IN_QUEUE');
  assert.ok(r.recommendation.manualReasons.some((x) => x.includes('авто-лимита')));
  const sc2 = score({ company: company(48), financials: fin(), terms: terms(1_000_000), now });
  const r2 = decide({ product: working, requested: terms(1_000_000), scoring: sc2, documents: docs(['bank_statement']), financials: fin() });
  assert.equal(r2.outcome, 'IN_QUEUE');
  assert.ok(r2.recommendation.manualReasons.some((x) => x.startsWith('Не хватает документов')));
});

test('Кредитная логика: высокий риск — в очередь с рекомендацией отказа', () => {
  const f = fin({ existingDebt: 40_000_000, overdueClosed12m: 2, avgTurnover3m: 2_000_000 });
  const sc = score({ company: company(24), financials: f, terms: terms(1_000_000), now });
  assert.equal(sc.zone, 'high_risk');
  const r = decide({ product: working, requested: terms(1_000_000), scoring: sc, documents: fullDocs, financials: f });
  assert.equal(r.outcome, 'IN_QUEUE');
  assert.equal(r.recommendation.type, 'reject');
});

test('Кредитная логика: сумма встречного предложения — платёж ≤ 35% оборота, шаг 50 тыс.', () => {
  const requested = terms(10_000_000, 12);
  const amount = counterAmount(working, requested, 2_000_000)!;
  assert.equal(amount % 50_000, 0);
  assert.ok(calculateSchedule({ ...requested, amount }).maxPayment <= 0.35 * 2_000_000);
  assert.ok(calculateSchedule({ ...requested, amount: amount + 50_000 }).maxPayment > 0.35 * 2_000_000);
  assert.equal(counterAmount(working, requested, 10_000), null);
});

/* ---------- Пайплайн и сид ---------- */

test('Пайплайн: ООО «Орион» получает авто-отказ по стоп-фактору', () => {
  const seed = createSeed(now);
  const base = { ...seed.applications.find((a) => a.id === '20101')! };
  const orion = lookupCompany(LIQUIDATED_INN, now);
  const app = { ...base, company: orion, financials: prefillFinancials(LIQUIDATED_INN), consents: { bki: true, personalData: true, authority: true } };
  const done = runPipelineSync(submit(app, now, { role: 'client', name: 'Клиент' }), now);
  assert.equal(done.status, 'REJECTED');
  assert.equal(done.decision?.decidedBy, 'system');
  assert.ok(done.history.some((e) => e.text === 'Получена кредитная история'));
});

test('Сид: номера уникальны, баллы посчитаны моделью', () => {
  const seed = createSeed(now);
  const ids = seed.applications.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of seed.applications.filter((x) => x.scoring)) {
    const again = score({ company: a.company, financials: a.financials!, terms: a.requested, now: new Date(a.scoring!.calculatedAt) });
    assert.equal(again.score, a.scoring!.score, `№ ${a.id}`);
  }
  const statuses = new Set(seed.applications.map((a) => a.status));
  for (const s of ['DRAFT', 'NEED_INFO', 'IN_REVIEW', 'COUNTER_OFFER', 'REJECTED', 'ISSUED', 'IN_QUEUE', 'SIGNING', 'DECLINED_BY_CLIENT', 'WITHDRAWN']) {
    assert.ok(statuses.has(s as never), s);
  }
});
