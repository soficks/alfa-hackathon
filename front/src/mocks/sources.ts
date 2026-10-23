import type { Company, ExternalSources } from '../domain/types.ts';

/**
 * Мок внешних источников (§5 ТЗ): Федресурс, ФССП, ЗСК ЦБ, перечни, дисквалификации,
 * блокировки ФНС, налоговая дисциплина, ГИР БО и декларации. Всё синтетическое.
 * По умолчанию — «чистая» компания; отклонения заданы для демо-сценариев.
 */
type Override = Partial<Omit<ExternalSources, 'checkedAt' | 'registryStatus'>>;

const KNOWN: Record<string, Override> = {
  // ИП Соколова: разовые задержки налогов, крупная доля наличных
  '772834567838': { taxDiscipline: 'minor', taxDebt: 40_000 },
  // ИП Кузнецов: небольшой налоговый долг
  '502478901250': { taxDiscipline: 'minor', taxDebt: 5_000 },
  // ООО «Север»: иск от бывшего контрагента
  '7810345670': { lawsuits: 900_000 },
};

export function checkSources(company: Company, revenue12m: number, now = new Date()): ExternalSources {
  const o = KNOWN[company.inn] ?? {};
  return {
    registryStatus: company.status === 'liquidated' ? 'liquidated' : 'active',
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
    girboRevenue: company.form === 'ООО' ? Math.round(revenue12m * 0.97) : undefined,
    declaredRevenue: Math.round(revenue12m * 0.95),
    ...o,
    checkedAt: now.toISOString(),
  };
}
