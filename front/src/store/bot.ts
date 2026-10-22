import { STATUS_LABEL, goalById, nextStepText } from './data';
import type { ChatMessage, State } from './types';
import { DEMO_RATE, calculateLoan } from '../utils/finance';
import { months, rub } from '../utils/format';

export const QUICK_QUESTIONS = ['Какие документы нужны?', 'Где моя заявка?', 'Какой будет платёж?', 'Как загрузить выписку?'];

type Reply = Pick<ChatMessage, 'text' | 'kind' | 'appId'>;

/**
 * Демонстрационные ответы по ключевым словам.
 * При подключении backend заменить на запрос к ассистенту.
 */
export function botReply(question: string, state: State): Reply {
  const q = question.toLowerCase();
  const pending = state.applications.find((a) => a.status === 'NEED_INFO');
  const active =
    pending ?? state.applications.find((a) => ['COUNTER_OFFER', 'MANUAL_REVIEW', 'SUBMITTED', 'APPROVED'].includes(a.status));

  if (/выписк|загруз/.test(q)) {
    if (pending) {
      return {
        text: `Для заявки № ${pending.id} нужна ${pending.request ?? 'выписка'}.\nОстальные данные сохранены.`,
        kind: 'upload',
        appId: pending.id,
      };
    }
    return { text: 'Сейчас дополнительные выписки не нужны — все документы по заявкам получены.' };
  }

  if (/документ/.test(q)) {
    return {
      text:
        'Обычно для кредита бизнесу нужны:\n• выписка по расчётному счёту за 6 месяцев;\n• паспорт руководителя;\n• отчётность за последний год.\nРеквизиты компании подставим из профиля. Точный список зависит от продукта.',
    };
  }

  if (/плат[её]ж|сколько|ставк|процент|услов/.test(q)) {
    const { amount, term } = state.wizard;
    const { payment, overpayment } = calculateLoan(amount, term);
    return {
      text: `При сумме ${rub(amount)} на ${months(term)} ежемесячный платёж — около ${rub(payment)}, переплата ${rub(overpayment)}.\nРасчёт по условной ставке ${DEMO_RATE}% годовых — точные условия будут после проверки.`,
    };
  }

  if (/заявк|статус|где|рассмотр/.test(q)) {
    if (!active) return { text: 'Активных заявок сейчас нет. Подобрать финансирование можно в разделе «Финансирование».' };
    return {
      text: `Заявка № ${active.id} (${goalById(active.goal).title.toLowerCase()}) — статус «${STATUS_LABEL[active.status]}».\n${nextStepText(active)}`,
    };
  }

  if (/госуслуг/.test(q)) {
    return { text: 'Интеграция с Госуслугами пока не подключена: в демо данные заполняются вручную.' };
  }

  if (/привет|здравств|добрый/.test(q)) {
    return { text: 'Здравствуйте! Спросите про документы, статус заявки или платёж — подскажу.' };
  }

  return {
    text: 'Пока не могу ответить на этот вопрос. Выберите тему из подсказок или позовите оператора — переписка сохранится.',
  };
}

export const operatorReply = () =>
  'Спасибо, вопрос приняла. Проверю детали по вашей заявке и вернусь с ответом в течение нескольких минут.';
