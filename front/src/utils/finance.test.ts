import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLoan, validateCompany, type CompanyFields } from './finance.ts';
import { months } from './format.ts';

test('График полностью погашает долг, итоги совпадают с платежами', () => {
  for (const amount of [500_000, 2_000_000, 5_000_000]) {
    for (const term of [6, 24, 36]) {
      const r = calculateLoan(amount, term);
      assert.equal(r.schedule.length, term);
      assert.equal(r.schedule.at(-1)!.balance, 0);
      assert.ok(Math.abs(r.schedule.reduce((s, x) => s + x.principal, 0) - amount) < 0.01);
      assert.ok(Math.abs(r.total - amount - r.overpayment) < 0.01);
      assert.ok(r.schedule.every((x) => x.balance >= 0 && x.principal > 0));
    }
  }
});

test('Нулевая ставка и некорректные параметры', () => {
  assert.equal(calculateLoan(120_000, 12, 0).total, 120_000);
  assert.throws(() => calculateLoan(-1, 12));
});

test('Срок и реквизиты ООО / ИП', () => {
  assert.equal(months(24), '24 месяца');
  assert.equal(months(12), '12 месяцев');
  const c: CompanyFields = {
    type: 'ООО',
    name: 'Тест',
    inn: '1234567890',
    ogrn: '1234567890123',
    address: 'Москва',
    contact: 'Юлия',
    email: 'demo@example.com',
    phone: '+79990000000',
  };
  assert.deepEqual(validateCompany(c), {});
  assert.ok(validateCompany({ ...c, type: 'ИП' }).inn);
});
