/** Отчёт по сиду: статус, балл, зона, рекомендация. Запуск: node scripts/seed-report.ts */
import { createSeed } from '../src/mocks/seed.ts';

const s = createSeed();
for (const a of [...s.applications].sort((x, y) => x.id.localeCompare(y.id))) {
  const f = a.scoring?.factors.map((x) => `${x.id}:${x.points}`).join(' ') ?? '';
  console.log(a.id, a.company.name.padEnd(30), a.status.padEnd(18), String(a.scoring?.score ?? '-').padStart(4), a.scoring?.zone ?? '', '|', a.recommendation?.text ?? '', '|', f);
}
