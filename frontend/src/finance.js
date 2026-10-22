export const DEMO_RATE = 18;
export function calculateLoan(amount, months, annualRate = DEMO_RATE) {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(months) ||
    months <= 0 ||
    !Number.isFinite(annualRate) ||
    annualRate < 0
  )
    throw new Error("Некорректные параметры кредита");
  const rate = annualRate / 1200;
  const exact = rate
    ? (amount * rate) / (1 - (1 + rate) ** -months)
    : amount / months;
  const payment = Math.round(exact * 100) / 100;
  let balance = amount;
  const schedule = Array.from({ length: months }, (_, i) => {
    const interest = Math.round(balance * rate * 100) / 100;
    const principal =
      i === months - 1
        ? Math.round(balance * 100) / 100
        : Math.min(balance, Math.round((payment - interest) * 100) / 100);
    balance = Math.max(0, Math.round((balance - principal) * 100) / 100);
    return {
      month: i + 1,
      payment: Math.round((principal + interest) * 100) / 100,
      principal,
      interest,
      balance,
    };
  });
  const total =
    Math.round(schedule.reduce((sum, row) => sum + row.payment, 0) * 100) / 100;
  return {
    payment,
    total,
    overpayment: Math.round((total - amount) * 100) / 100,
    schedule,
  };
}
export const rub = (n, decimals = 0) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: decimals,
  }).format(n);
export function monthLabel(n) {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? "месяц" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "месяца" : "месяцев"}`;
}
export function validateCompany(c) {
  const errors = {};
  if (!c.name.trim()) errors.name = "Укажите название компании";
  if (!new RegExp(c.type === "ООО" ? "^\\d{10}$" : "^\\d{12}$").test(c.inn))
    errors.inn =
      c.type === "ООО" ? "ИНН организации — 10 цифр" : "ИНН ИП — 12 цифр";
  if (!new RegExp(c.type === "ООО" ? "^\\d{13}$" : "^\\d{15}$").test(c.ogrn))
    errors.ogrn = c.type === "ООО" ? "ОГРН — 13 цифр" : "ОГРНИП — 15 цифр";
  if (!c.address.trim()) errors.address = "Укажите юридический адрес";
  if (!c.contact.trim()) errors.contact = "Укажите контактное лицо";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
    errors.email = "Проверьте email";
  if (!/^[78]\d{10}$/.test(c.phone.replace(/\D/g, "")))
    errors.phone = "Введите российский номер: +7 и 10 цифр";
  return errors;
}
