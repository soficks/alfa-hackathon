/**
 * Кредитная политика демо-конвейера (docs/TZ_credit_pipeline.md, §16).
 * Все пороги конфигурируемые. status: 'from_tz' — значение из приоритетного файла ТЗ,
 * 'proposal' — предложение, ещё не утверждённое командой (APPROVED_BY_TEAM не выставлен).
 */
export const POLICY = {
  version: 'demo-2026-10-23',

  /* Платёжеспособность (§8) */
  DSCR_MIN: 1.25, // авто-одобрение
  DSCR_GRAY: 1.1, // нижняя граница серой зоны
  DSCR_REJECT: 1.0, // ниже на всех вариантах — отказ F02
  STRESS_S: 0.2, // падение выручки в стресс-сценарии
  DSCR_STRESS_MIN: 1.0,
  DSCR_STRESS_GRAY: 0.9,
  DEBT_CF_OK: 3,
  DEBT_CF_MAX: 4,
  K_REVENUE: 0.5, // лимит не больше половины годовой выручки
  CV_SEASONAL: 0.3, // выше — считаем DSCR слабого периода
  TREND_MIN: 0.7, // ниже — мягкий стоп S09

  /* Срок работы бизнеса */
  AGE_MIN: 6,
  AGE_OK: 12,

  /* Калибровка балла в PD (§10) */
  PDO: 20,
  SCORE0: 600,
  ODDS0: 50,
  GRADE: { A: 640, B: 610, C: 580, D: 550 },

  /* Лимиты и полномочия */
  AUTO_AUTHORITY: 3_000_000, // предложение В13
  EMPLOYEE_AUTHORITY: 30_000_000, // демо: выше — нужен старший уровень (G09)
  CORPORATE_APPROVAL_AMOUNT: 10_000_000, // демо: для ООО выше — корпоративное одобрение (G03)
  MANUAL_OVER_LIMIT: 0.1, // сотрудник не может превысить расчётный лимит больше чем на 10%

  /* Мягкие стопы — пороги-предложения (В12 и др.) */
  S03_DECLARATION_DIFF: 0.3,
  S04_TOP_BUYER: 0.5,
  S06_TAX_DEBT_TO_CF: 0.1,
  S08_LAWSUITS_TO_REVENUE: 0.1,
  S10_CASH_SHARE: 0.2,
  H09_OVERDUE_DAYS: 30,
  D09_DEBT_DIFF: 0.1, // анкета и БКИ расходятся больше чем на 10%
  D10_GIRBO_DIFF: 0.1,

  /* Сроки (§15) */
  NEED_INFO_DAYS: 10, // рабочих дней
  NEED_INFO_CYCLES: 2,
  REMIND_BEFORE_DAYS: 3,
  REVIEW_SLA_DAYS: 2, // рабочих дня
  OFFER_TTL_DAYS: 30,

  /* Поиск контрпредложений (§11) */
  W_SUM: 1,
  W_TERM: 0.5,
  OFFERS_MAX: 3,
} as const;

/** Статус согласования ключевых значений — показывается в README и интерфейсе сотрудника. */
export const POLICY_STATUS: Record<string, 'from_tz' | 'proposal'> = {
  DSCR: 'from_tz',
  STRESS: 'from_tz',
  DEBT_CF: 'from_tz',
  GRADES: 'from_tz',
  PD_CALIBRATION: 'from_tz',
  AUTO_AUTHORITY: 'proposal',
  S06_S10: 'proposal',
  EMPLOYEE_AUTHORITY: 'proposal',
  CORPORATE_APPROVAL_AMOUNT: 'proposal',
  INDUSTRY_DEFAULT: 'proposal',
};
