import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkInn,
  completeInn10,
  completeInn12,
  completeOgrn,
  completeOgrnip,
  formByInn,
  isValidInn,
  isValidOgrn,
  isValidOgrnip,
} from './requisites.ts';
import { calculateSchedule, maxAmountForPayment, minTermForPayment, paymentSummary } from './finance.ts';
import { TRANSITIONS, TransitionError, assertTransition, canTransition, isFinal } from './stateMachine.ts';
import type { PaymentType } from './types.ts';
import { addBusinessDays, monthsBetween } from './time.ts';
import { businessAge, months, plural } from '../utils/format.ts';

/* ---------- Реквизиты ---------- */

test('ИНН: известные валидные номера юрлица и ИП', () => {
  assert.ok(isValidInn('7707083893'));
  assert.ok(isValidInn('500100732259'));
  assert.equal(formByInn('7707083893'), 'ООО');
  assert.equal(formByInn('500100732259'), 'ИП');
});

test('ИНН: опечатка в контрольной цифре и неверная длина', () => {
  assert.equal(isValidInn('7707083894'), false);
  assert.equal(isValidInn('500100732258'), false);
  assert.equal(isValidInn('77070838'), false);
  assert.equal(checkInn('7707083894').ok, false);
  assert.match(checkInn('123').error!, /10 цифр/);
  assert.match(checkInn('77О7083893').error!, /только из цифр/);
  assert.deepEqual(checkInn('7707083893'), { ok: true, form: 'ООО' });
});

test('ОГРН и ОГРНИП: контрольные суммы', () => {
  assert.ok(isValidOgrn('1027700132195'));
  assert.equal(isValidOgrn('1027700132194'), false);
  assert.ok(isValidOgrnip('304500116000157'));
  assert.equal(isValidOgrnip('304500116000158'), false);
  assert.equal(isValidOgrn('102770013219'), false);
});

test('Генераторы дают валидные номера', () => {
  for (let i = 0; i < 50; i++) {
    const p = String(770000000 + i * 7919).padStart(9, '0');
    assert.ok(isValidInn(completeInn10(p)));
    assert.ok(isValidInn(completeInn12(`50${p.slice(0, 8)}`)));
    assert.ok(isValidOgrn(completeOgrn(`10277${String(i * 31337).padStart(7, '0')}`)));
    assert.ok(isValidOgrnip(completeOgrnip(`3045001${String(i * 7777).padStart(7, '0')}`)));
  }
});

/* ---------- Графики ---------- */

const TYPES: PaymentType[] = ['annuity', 'differentiated', 'interest_only', 'annuity_grace'];
const close = (a: number, b: number, eps = 0.011) => Math.abs(a - b) < eps;

test('Все типы: долг погашен, итоги сходятся, проценты первого месяца верны', () => {
  for (const paymentType of TYPES) {
    for (const [amount, term, rate] of [
      [500_000, 6, 21],
      [2_000_000, 24, 18],
      [3_500_000, 36, 19],
      [30_000_000, 120, 22],
    ] as const) {
      const s = calculateSchedule({ amount, term, rate, paymentType, graceMonths: paymentType === 'annuity_grace' ? 3 : undefined });
      assert.equal(s.rows.length, term, paymentType);
      assert.equal(s.rows.at(-1)!.balance, 0, `${paymentType}: остаток в конце`);
      assert.ok(close(s.rows.reduce((x, r) => x + r.principal, 0), amount), `${paymentType}: сумма основного долга`);
      assert.ok(close(s.rows.reduce((x, r) => x + r.payment, 0), s.total), `${paymentType}: итог`);
      assert.ok(close(s.total - amount, s.overpayment), `${paymentType}: переплата`);
      assert.ok(close(s.rows[0].interest, Math.round(((amount * rate) / 12 / 100) * 100) / 100), `${paymentType}: проценты 1-го месяца`);
      assert.ok(s.rows.every((r) => r.balance >= 0 && r.principal >= 0));
      assert.equal(s.maxPayment, Math.max(...s.rows.map((r) => r.payment)));
    }
  }
});

test('Дифференцированный: переплата меньше, чем у аннуитета; первый платёж выше последнего', () => {
  const base = { amount: 3_500_000, term: 36, rate: 19 };
  const a = calculateSchedule({ ...base, paymentType: 'annuity' });
  const d = calculateSchedule({ ...base, paymentType: 'differentiated' });
  assert.ok(d.overpayment < a.overpayment);
  assert.ok(d.firstPayment > d.lastPayment);
  assert.equal(d.maxPayment, d.firstPayment);
});

test('Проценты ежемесячно: весь долг в последнем платеже', () => {
  const s = calculateSchedule({ amount: 1_200_000, term: 12, rate: 22, paymentType: 'interest_only' });
  assert.ok(s.rows.slice(0, -1).every((r) => r.principal === 0));
  assert.equal(s.rows.at(-1)!.principal, 1_200_000);
  assert.equal(s.maxPayment, s.lastPayment);
});

test('С отсрочкой: первые месяцы только проценты, затем аннуитет', () => {
  const s = calculateSchedule({ amount: 3_000_000, term: 24, rate: 19, paymentType: 'annuity_grace', graceMonths: 3 });
  assert.ok(s.rows.slice(0, 3).every((r) => r.principal === 0));
  assert.ok(s.rows[3].principal > 0);
  assert.equal(s.afterGracePayment, s.rows[3].payment);
  assert.deepEqual(
    paymentSummary({ amount: 3_000_000, term: 24, rate: 19, paymentType: 'annuity_grace', graceMonths: 3 }).map((x) => x.label),
    ['Платёж в отсрочку', 'Платёж после'],
  );
});

test('Аннуитет 2 млн / 24 мес / 18% — как в прежнем калькуляторе', () => {
  assert.ok(close(calculateSchedule({ amount: 2_000_000, term: 24, rate: 18, paymentType: 'annuity' }).firstPayment, 99_848.21, 0.02));
});

test('Нулевая ставка', () => {
  for (const paymentType of TYPES) {
    const s = calculateSchedule({ amount: 120_000, term: 12, rate: 0, paymentType, graceMonths: 2 });
    assert.equal(s.total, 120_000);
    assert.equal(s.overpayment, 0);
  }
});

test('Некорректные параметры дают ошибку', () => {
  assert.throws(() => calculateSchedule({ amount: -1, term: 12, rate: 10, paymentType: 'annuity' }));
  assert.throws(() => calculateSchedule({ amount: 100, term: 0, rate: 10, paymentType: 'annuity' }));
  assert.throws(() => calculateSchedule({ amount: 100, term: 1.5, rate: 10, paymentType: 'annuity' }));
  assert.throws(() => calculateSchedule({ amount: 100, term: 12, rate: -1, paymentType: 'annuity' }));
  assert.throws(() => calculateSchedule({ amount: 100, term: 3, rate: 10, paymentType: 'annuity_grace', graceMonths: 3 }));
});

test('Подбор суммы и срока под лимит платежа', () => {
  const terms = { term: 36, rate: 19, paymentType: 'annuity' as const };
  const max = maxAmountForPayment(100_000, terms, 50_000);
  assert.ok(calculateSchedule({ ...terms, amount: max }).maxPayment <= 100_000);
  assert.ok(calculateSchedule({ ...terms, amount: max + 50_000 }).maxPayment > 100_000);
  const t = minTermForPayment(100_000, { amount: 3_000_000, rate: 19, paymentType: 'annuity' }, 12, 60)!;
  assert.ok(calculateSchedule({ amount: 3_000_000, rate: 19, paymentType: 'annuity', term: t }).maxPayment <= 100_000);
  assert.ok(calculateSchedule({ amount: 3_000_000, rate: 19, paymentType: 'annuity', term: t - 1 }).maxPayment > 100_000);
});

/* ---------- Стейт-машина ---------- */

test('Стейт-машина: разрешённые и запрещённые переходы', () => {
  assert.ok(canTransition('DRAFT', 'SUBMITTED'));
  assert.ok(canTransition('AUTO_CHECKS', 'IN_QUEUE'));
  assert.ok(canTransition('IN_QUEUE', 'AUTO_CHECKS'));
  assert.ok(canTransition('NEED_INFO', 'IN_REVIEW'));
  assert.ok(canTransition('COUNTER_OFFER', 'DECLINED_BY_CLIENT'));
  assert.ok(canTransition('SIGNING', 'ISSUED'));
  assert.equal(canTransition('DRAFT', 'WITHDRAWN'), false, 'черновик удаляется, а не отзывается');
  assert.equal(canTransition('APPROVED', 'WITHDRAWN'), false);
  assert.equal(canTransition('IN_QUEUE', 'APPROVED'), false);
  assert.throws(() => assertTransition('ISSUED', 'IN_REVIEW'), TransitionError);
});

test('Финальные статусы не имеют переходов', () => {
  for (const s of ['ISSUED', 'REJECTED', 'DECLINED_BY_CLIENT', 'WITHDRAWN'] as const) {
    assert.ok(isFinal(s));
    assert.deepEqual(TRANSITIONS[s], []);
  }
});

/* ---------- Даты и тексты ---------- */

test('Рабочие дни пропускают выходные', () => {
  const friday = new Date(2026, 9, 23, 15, 0); // пятница
  assert.equal(addBusinessDays(friday, 1).getDay(), 1);
  assert.equal(addBusinessDays(friday, 2).getDate(), 27);
  assert.equal(monthsBetween(new Date(2022, 9, 23), new Date(2026, 9, 23)), 48);
});

test('Склонения', () => {
  assert.equal(months(24), '24 месяца');
  assert.equal(months(11), '11 месяцев');
  assert.equal(plural(1, ['проверка', 'проверки', 'проверок']), 'проверка');
  assert.equal(plural(2, ['проверка', 'проверки', 'проверок']), 'проверки');
  assert.equal(plural(5, ['проверка', 'проверки', 'проверок']), 'проверок');
  assert.equal(plural(21, ['проверка', 'проверки', 'проверок']), 'проверка');
  assert.equal(businessAge(51), '4 года 3 месяца');
});
