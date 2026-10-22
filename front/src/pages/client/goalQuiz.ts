import { GOALS, productById, type Goal } from '../../config/products';

/** Мини-подбор цели по трём вопросам. Правила, без моделей. */

export const PURPOSES = [
  { id: 'current', label: 'Закупки, зарплата, текущие расходы', goals: ['working', 'cash_gap'], phrase: 'текущих расходов и закупок' },
  { id: 'gap', label: 'Перекрыть паузу до оплаты от покупателей', goals: ['cash_gap', 'working'], phrase: 'паузы до оплаты от покупателей' },
  { id: 'equipment', label: 'Оборудование или транспорт', goals: ['equipment', 'transport'], phrase: 'покупки оборудования и техники' },
  { id: 'property', label: 'Помещение: покупка или ремонт', goals: ['real_estate', 'growth'], phrase: 'помещения для бизнеса' },
  { id: 'growth', label: 'Новая точка, направление или команда', goals: ['growth', 'equipment'], phrase: 'развития бизнеса' },
  { id: 'contract', label: 'Исполнить госконтракт', goals: ['gov_contract', 'cash_gap'], phrase: 'исполнения госконтракта' },
  { id: 'refinance', label: 'Погасить кредиты в других банках', goals: ['refinance'], phrase: 'рефинансирования кредитов' },
] as const;

export const RETURNS = [
  { id: 'lump', label: 'Одной суммой, когда придёт оплата', range: [1, 24] },
  { id: 'year', label: 'В течение года', range: [1, 12] },
  { id: 'mid', label: 'За 1–3 года', range: [12, 36] },
  { id: 'long', label: 'Дольше 3 лет', range: [37, 120] },
] as const;

export const COLLATERAL = [
  { id: 'yes', label: 'Да, есть' },
  { id: 'no', label: 'Нет' },
] as const;

export interface QuizAnswers {
  purpose?: (typeof PURPOSES)[number]['id'];
  returns?: (typeof RETURNS)[number]['id'];
  collateral?: (typeof COLLATERAL)[number]['id'];
}

export interface Suggestion {
  goal: Goal;
  reasons: string[];
}

export function suggestGoals(a: QuizAnswers): Suggestion[] {
  const purpose = PURPOSES.find((p) => p.id === a.purpose);
  const ret = RETURNS.find((r) => r.id === a.returns);
  if (!purpose || !ret || !a.collateral) return [];

  const ranked = purpose.goals.map((goalId, order) => {
    const goal = GOALS.find((g) => g.id === goalId)!;
    const p = productById(goal.productId);
    const reasons: string[] = [];
    let score = order === 0 ? 3 : 1;
    if (order === 0) reasons.push(`Создан для ${purpose.phrase}.`);

    const [from, to] = ret.range;
    const fits = p.minTerm <= to && p.maxTerm >= from;
    if (fits) {
      score += 2;
      reasons.push(`Срок от ${p.minTerm} до ${p.maxTerm} мес. — подходит, если планируете вернуть ${ret.label.toLowerCase()}.`);
    } else {
      score -= 2;
    }

    const lumpSum = p.paymentTypes.includes('interest_only');
    if (a.returns === 'lump' && lumpSum) {
      score += 2;
      reasons.push('Каждый месяц платите только проценты, а долг возвращаете одной суммой, когда придут деньги.');
    }
    if (a.returns !== 'lump' && lumpSum && order > 0) score -= 1;

    if (p.collateral.required && a.collateral === 'no') {
      score -= 3;
      reasons.push('Нужен залог — без него этот вариант не подойдёт.');
    } else if (p.collateral.required) {
      reasons.push('Залог есть — можно получить большую сумму на долгий срок.');
    } else {
      reasons.push('Залог не нужен.');
    }
    return { goal, reasons, score };
  });

  const best = ranked.sort((x, y) => y.score - x.score).filter((x) => x.score > 0);
  return (best.length ? best : ranked).slice(0, 2).map(({ goal, reasons }) => ({ goal, reasons }));
}
