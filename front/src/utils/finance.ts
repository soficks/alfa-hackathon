/** Условная ставка для демо-расчёта, % годовых. */
export const DEMO_RATE = 18;

export const AMOUNT_MIN = 500_000;
export const AMOUNT_MAX = 5_000_000;
export const AMOUNT_STEP = 50_000;
export const AMOUNT_POINTS = [500_000, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000];
export const AMOUNT_PRESETS = [500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000];

export const TERM_MIN = 6;
export const TERM_MAX = 36;
export const TERM_STEP = 1;
export const TERM_POINTS = [6, 12, 18, 24, 30, 36];

export interface ScheduleRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface LoanCalculation {
  payment: number;
  total: number;
  overpayment: number;
  schedule: ScheduleRow[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Аннуитетный платёж; последний платёж корректируется до полного погашения. */
export function calculateLoan(amount: number, months: number, annualRate = DEMO_RATE): LoanCalculation {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(months) || months <= 0 || !Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error('Некорректные параметры кредита');
  }
  const rate = annualRate / 1200;
  const payment = cents(rate ? (amount * rate) / (1 - (1 + rate) ** -months) : amount / months);
  let balance = amount;
  const schedule = Array.from({ length: months }, (_, i): ScheduleRow => {
    const interest = cents(balance * rate);
    const principal = i === months - 1 ? cents(balance) : Math.min(balance, cents(payment - interest));
    balance = Math.max(0, cents(balance - principal));
    return { month: i + 1, payment: cents(principal + interest), principal, interest, balance };
  });
  const total = cents(schedule.reduce((sum, row) => sum + row.payment, 0));
  return { payment, total, overpayment: cents(total - amount), schedule };
}

export interface CompanyFields {
  type: 'ООО' | 'ИП';
  name: string;
  inn: string;
  ogrn: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
}

/** Проверка формата реквизитов (без реестров и контрольных сумм). */
export function validateCompany(c: CompanyFields): Partial<Record<keyof CompanyFields, string>> {
  const isLlc = c.type === 'ООО';
  const errors: Partial<Record<keyof CompanyFields, string>> = {};
  if (!c.name.trim()) errors.name = 'Укажите название компании';
  if (!(isLlc ? /^\d{10}$/ : /^\d{12}$/).test(c.inn)) errors.inn = isLlc ? 'ИНН организации — 10 цифр' : 'ИНН ИП — 12 цифр';
  if (!(isLlc ? /^\d{13}$/ : /^\d{15}$/).test(c.ogrn)) errors.ogrn = isLlc ? 'ОГРН — 13 цифр' : 'ОГРНИП — 15 цифр';
  if (!c.address.trim()) errors.address = 'Укажите юридический адрес';
  if (!c.contact.trim()) errors.contact = 'Укажите контактное лицо';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.email = 'Проверьте email';
  if (!/^[78]\d{10}$/.test(c.phone.replace(/\D/g, ''))) errors.phone = 'Введите российский номер: +7 и 10 цифр';
  return errors;
}
