import test from "node:test";
import assert from "node:assert/strict";
import { calculateLoan, validateCompany, monthLabel } from "./finance.js";
test("График полностью погашает долг, итоги совпадают с платежами", () => {
  for (const amount of [500000, 2000000, 5000000])
    for (const months of [6, 24, 36]) {
      const r = calculateLoan(amount, months);
      assert.equal(r.schedule.length, months);
      assert.equal(r.schedule.at(-1).balance, 0);
      assert.ok(
        Math.abs(r.schedule.reduce((s, x) => s + x.principal, 0) - amount) <
          0.01,
      );
      assert.ok(Math.abs(r.total - amount - r.overpayment) < 0.01);
      assert.ok(r.schedule.every((x) => x.balance >= 0 && x.principal > 0));
    }
});
test("Нулевая ставка и некорректные параметры", () => {
  assert.equal(calculateLoan(120000, 12, 0).total, 120000);
  assert.throws(() => calculateLoan(-1, 12));
});
test("Срок и реквизиты ООО / ИП", () => {
  assert.equal(monthLabel(24), "24 месяца");
  assert.equal(monthLabel(12), "12 месяцев");
  const c = {
    type: "ООО",
    name: "Тест",
    inn: "1234567890",
    ogrn: "1234567890123",
    address: "Москва",
    contact: "Юлия",
    email: "demo@example.com",
    phone: "+79990000000",
  };
  assert.deepEqual(validateCompany(c), {});
  assert.ok(validateCompany({ ...c, type: "ИП" }).inn);
});
