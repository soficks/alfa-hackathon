import type { Application, BotMessage, DbState, Wizard } from '../domain/types.ts';
import { PAYMENT_TYPE_HINT, PAYMENT_TYPE_LABEL, calculateSchedule, paymentSummary } from '../domain/finance.ts';
import { isFinal } from '../domain/stateMachine.ts';
import { CLIENT_STATUS_LABEL, clientNextStep, openRequests } from '../domain/statusText.ts';
import { DOC_TYPES } from '../config/docTypes.ts';
import { goalById, productById } from '../config/products.ts';
import { months, rub } from '../utils/format.ts';

/**
 * Помощник отвечает по правилам и данным кабинета (без LLM).
 * Ответы опираются на реальный процесс: продукт черновика, статусы заявок, тип платежа.
 */
type Reply = Omit<BotMessage, 'id' | 'at' | 'from'>;

const appLink = (a: Application) => ({ to: `/applications/${a.id}`, label: `Заявка № ${a.id}` });

export function greeting(firstName: string): Reply {
  return { text: `Здравствуйте, ${firstName}! Помогу с документами, расчётом платежа и вашими заявками.`, kind: 'greeting' };
}

export function botReply(question: string, state: DbState, userId: string): Reply {
  const q = question.toLowerCase();
  const apps = state.applications.filter((a) => a.ownerUserId === userId);
  const active = apps.filter((a) => a.status !== 'DRAFT' && !isFinal(a.status));
  const wizard: Wizard | undefined = state.wizards[userId];
  const waiting = active.find((a) => openRequests(a).length > 0);

  if (/выписк|загруз|прикреп/.test(q)) {
    if (waiting) {
      const req = openRequests(waiting)[0];
      return {
        text: `Для заявки № ${waiting.id} специалист ждёт: ${DOC_TYPES[req.docType].title.toLowerCase()}.${req.comment ? `\nКомментарий: «${req.comment}»` : ''}`,
        kind: 'upload',
        appId: waiting.id,
        requestId: req.id,
      };
    }
    return { text: 'Сейчас специалисты ничего не запрашивали. Документы для новой заявки загружаются на шаге «Финансы и документы».' };
  }

  if (/документ|справк|что нужно/.test(q)) {
    if (waiting) {
      const list = openRequests(waiting).map((r) => `• ${DOC_TYPES[r.docType].title}`).join('\n');
      return { text: `По заявке № ${waiting.id} специалист запросил:\n${list}\nЗагрузить можно в карточке заявки или прямо здесь.`, links: [appLink(waiting)] };
    }
    const productId = wizard ? goalById(wizard.goalId).productId : active[0]?.productId;
    if (productId) {
      const product = productById(productId);
      const list = product.requiredDocs.map((t) => `• ${DOC_TYPES[t].title} — ${DOC_TYPES[t].why.toLowerCase()}`).join('\n');
      return {
        text: `Для продукта «${product.name}» нужны:\n${list}\nДанные компании подтянем из ЕГРЮЛ, кредиты — из кредитной истории, вводить их вручную не нужно.`,
      };
    }
    return { text: 'Список зависит от цели кредита. Выберите цель в разделе «Финансирование» — и я подскажу, какие документы понадобятся.', links: [{ to: '/financing', label: 'Выбрать цель' }] };
  }

  if (/статус|где|заявк|рассмотр|решени/.test(q)) {
    if (!active.length) {
      const draft = apps.find((a) => a.status === 'DRAFT');
      return draft
        ? { text: `Отправленных заявок сейчас нет. Есть черновик № ${draft.id} — его можно продолжить.`, links: [{ to: '/financing', label: 'К черновикам' }] }
        : { text: 'Активных заявок нет. Подобрать финансирование можно в разделе «Финансирование».', links: [{ to: '/financing', label: 'Подобрать' }] };
    }
    const lines = active.map((a) => `• № ${a.id} — ${CLIENT_STATUS_LABEL[a.status].toLowerCase()}. ${clientNextStep(a)}`).join('\n');
    return { text: `Ваши заявки в работе:\n${lines}`, links: active.slice(0, 3).map(appLink) };
  }

  if (/дифференц/.test(q)) {
    return { text: `Дифференцированный платёж: ${PAYMENT_TYPE_HINT.differentiated.toLowerCase()} Подходит, если сейчас оборотов хватает на более высокий платёж и хочется переплатить меньше.` };
  }

  if (/аннуитет/.test(q)) {
    return { text: `Аннуитетный платёж: ${PAYMENT_TYPE_HINT.annuity.toLowerCase()} В начале срока в платеже больше процентов, к концу — больше основного долга.` };
  }

  if (/отсрочк|льготн/.test(q)) {
    return { text: `Платёж с отсрочкой: ${PAYMENT_TYPE_HINT.annuity_grace.toLowerCase()} Доступен для оборудования и развития бизнеса.` };
  }

  if (/кредитн\w* истори|бки|бюро/.test(q)) {
    return {
      text: 'Кредитная история показывает, какие у компании уже есть кредиты и платит ли она вовремя. Так банк понимает, не станет ли новый платёж слишком тяжёлым. Запрос делаем только с вашего согласия, и он не портит историю.',
    };
  }

  if (/плат[её]ж|сколько|переплат|ставк/.test(q)) {
    if (!wizard) return { text: 'Платёж зависит от суммы, срока и типа платежа. Откройте калькулятор — он пересчитает всё сразу.', links: [{ to: '/financing/calculator', label: 'Калькулятор' }] };
    const product = productById(goalById(wizard.goalId).productId);
    const terms = { ...wizard.requested, rate: product.baseRate };
    const s = calculateSchedule(terms);
    const summary = paymentSummary(terms, s)
      .map((x) => `${x.label.toLowerCase()} — ${rub(x.value)}`)
      .join(', ');
    return {
      text: `По вашему расчёту: ${rub(terms.amount)} на ${months(terms.term)}, ${PAYMENT_TYPE_LABEL[terms.paymentType].toLowerCase()} платёж — ${summary}. Переплата ${rub(s.overpayment)} при ориентировочной ставке ${product.baseRate}%. Точные условия — после проверки.`,
      links: [{ to: '/financing/calculator', label: 'Изменить расчёт' }],
    };
  }

  if (/привет|здравств|добрый/.test(q)) return { text: 'Здравствуйте! Спросите про документы, статус заявки или платёж — подскажу.' };

  const target = waiting ?? active[0];
  return {
    text: 'Не нашёл ответа. Если вопрос по отправленной заявке — напишите специалисту в карточке заявки, он ответит там же.',
    links: target ? [{ to: `/applications/${target.id}#messages`, label: `Написать по заявке № ${target.id}` }] : undefined,
  };
}
