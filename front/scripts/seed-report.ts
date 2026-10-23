/** Отчёт по сиду: статус, балл, группа, DSCR, маршрут. Запуск: node scripts/seed-report.ts */
import { createSeed } from '../src/mocks/seed.ts';

const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '  —  ' : x.toFixed(2));
const s = createSeed();
for (const a of [...s.applications].sort((x, y) => x.id.localeCompare(y.id))) {
  const sc = a.scoring;
  const m = a.metrics;
  console.log(
    a.id,
    a.company.name.slice(0, 22).padEnd(22),
    a.status.padEnd(18),
    sc ? `${sc.score} ${sc.grade} PD ${(sc.pd * 100).toFixed(2)}%` : '-'.padEnd(16),
    `DSCR ${f2(m?.dscr)} стресс ${f2(m?.dscrStress)} долг/CF ${f2(m?.debtCf)}`,
    '|',
    a.route?.summary ?? '',
  );
}
