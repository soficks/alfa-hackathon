"""
Кредитный движок: график платежей, балльная модель 0–1000, PTI и решение по заявке.

Правила версионируются (RULESETS): заявка запоминает modelVersion при создании, и каждый пересчёт
(новая сумма или срок, загруженные сведения, ручной пересчёт сотрудником) идёт по той же версии,
поэтому балл меняется только из-за изменившихся данных, а не из-за обновления правил.

Входные данные берутся из самой заявки (то, что запросили у ФНС/БКИ/DWH и что поправил клиент),
а не из констант: движок ничего не знает про конкретные компании.

PTI = (текущие платежи по кредитам + платёж по новой заявке) / (подтверждённый оборот * 0.25)

Решение зависит от пути:
  * автоматический конвейер (демо-профили с DWH): Gatekeeper → Quality Check → Brain → Solver даёт
    APPROVED / COUNTER_OFFER / NEED_INFO / REJECTED сразу;
  * остальные компании: стоп-факторы → REJECTED, высокий балл и малая сумма → APPROVED,
    иначе IN_QUEUE с рекомендацией для сотрудника (решение принимает человек).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import sources as src

NBSP = " "


@dataclass(frozen=True)
class Rules:
    version: str
    turnover_to_cashflow: float = 0.25   # доля оборота, которую можно направить на обслуживание долга
    pti_approve: float = 0.5             # PTI < 0.5  -> одобрение
    pti_decline: float = 0.8             # PTI >= 0.8 -> отказ; между ними — встречное предложение
    max_amount_to_turnover: float = 2.0  # сумма заявки не больше 2 месячных оборотов, иначе нужна выписка
    term_grid: tuple[int, ...] = (6, 12, 18, 24, 36, 48, 60, 84, 120)  # сроки, которые перебирает Solver
    base_score: int = 500
    high_risk_score: int = 400           # ниже — зона высокого риска
    auto_score: int = 700                # от него — зона auto и право на авто-одобрение
    good_score: int = 800                # от него — скидка 1 п.п. к ставке
    counter_payment_share: float = 0.35  # встречное предложение: платёж ≤ 35% оборота за 3 мес
    stop_business_age_months: int = src.STOP_BUSINESS_AGE_MONTHS


RULESETS: dict[str, Rules] = {"demo-v1": Rules(version="demo-v1")}
DEFAULT_MODEL_VERSION = "demo-v1"


def rules_for(version: Optional[str]) -> Rules:
    return RULESETS.get(version or DEFAULT_MODEL_VERSION) or RULESETS[DEFAULT_MODEL_VERSION]


# ---------------------------------------------------------------------------
# Форматирование (как front/src/utils/format.ts)
# ---------------------------------------------------------------------------


def rub(n: float) -> str:
    return f"{src.js_round(n):,}".replace(",", NBSP) + f"{NBSP}₽"


def pct(x: float) -> str:
    return f"{src.js_round(x * 100)}%"


def plural(n: int, forms: tuple[str, str, str]) -> str:
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def months(n: int) -> str:
    return f"{n} {plural(n, ('месяц', 'месяца', 'месяцев'))}"


def business_age(total: int) -> str:
    y, m = divmod(total, 12)
    parts = [f"{y} {plural(y, ('год', 'года', 'лет'))}" if y else "", months(m) if m else ""]
    return " ".join(p for p in parts if p) or "меньше месяца"


def months_between(frm: datetime, to: datetime) -> int:
    m = (to.year - frm.year) * 12 + (to.month - frm.month)
    if to.day < frm.day:
        m -= 1
    return max(0, m)


# ---------------------------------------------------------------------------
# График платежей (как front/src/domain/finance.ts)
# ---------------------------------------------------------------------------


def schedule(amount: float, term: int, rate: float, payment_type: str, grace: int = 0) -> list[float]:
    """Платежи по месяцам. Месячная ставка = годовая / 12 / 100, последний платёж закрывает остаток."""
    r = rate / 12 / 100

    def annuity(principal: float, n: int) -> float:
        return principal * r / (1 - (1 + r) ** -n) if r else principal / n

    grace = grace if payment_type == "annuity_grace" else 0
    level = annuity(amount, term) if payment_type == "annuity" else annuity(amount, max(1, term - grace))
    balance, payments = float(amount), []
    for m in range(1, term + 1):
        interest = balance * r
        last = m == term
        if payment_type in ("annuity", "annuity_grace"):
            principal = 0.0 if m <= grace else balance if last else min(balance, level - interest)
        elif payment_type == "differentiated":
            principal = balance if last else min(balance, amount / term)
        else:  # interest_only
            principal = balance if last else 0.0
        balance -= principal
        payments.append(principal + interest)
    return payments


def load_payment(amount: float, term: int, rate: float, payment_type: str, grace: int = 0) -> float:
    """
    Платёж, по которому оцениваем нагрузку: максимальный по графику
    (дифференцированный — первый, с отсрочкой — после отсрочки).
    У «проценты ежемесячно, долг в конце» вместо разового погашения берём
    равномерный эквивалент: проценты + долг / срок.
    """
    if payment_type == "interest_only":
        return amount * rate / 12 / 100 + amount / term
    return max(schedule(amount, term, rate, payment_type, grace))


def max_amount_for_payment(payment: float, term: int, rate: float, payment_type: str, grace: int = 0) -> float:
    per_unit = load_payment(1_000_000, term, rate, payment_type, grace) / 1_000_000
    return payment / per_unit if per_unit > 0 else math.inf


def calc_pti(current_payments: float, new_payment: float, turnover: float, rules: Rules) -> float:
    capacity = turnover * rules.turnover_to_cashflow
    if capacity <= 0:
        return math.inf
    return (current_payments + new_payment) / capacity


def rate_for(product: dict, score: int, rules: Rules) -> float:
    """Ставка решения: базовая ставка продукта, при балле >= 800 — на 1 п.п. ниже."""
    return product["baseRate"] - 1 if score >= rules.good_score else product["baseRate"]


def zone_of(score: int, rules: Rules) -> str:
    return "high_risk" if score < rules.high_risk_score else "manual" if score < rules.auto_score else "auto"


# ---------------------------------------------------------------------------
# Балльная модель (как front/src/mocks/scoring.ts)
# ---------------------------------------------------------------------------


def stop_factors(company: dict, f: dict, now: datetime, rules: Rules) -> list[dict]:
    stops = []
    if company["status"] == "liquidated":
        stops.append({"code": "company_liquidated", "text": "Компания ликвидирована по данным ЕГРЮЛ"})
    if f["overdueCurrent"]:
        stops.append({"code": "overdue_current", "text": "Текущая просрочка по данным БКИ"})
    registered = datetime.fromisoformat(company["registeredAt"].replace("Z", "+00:00"))
    if months_between(registered, now) < rules.stop_business_age_months:
        stops.append({"code": "business_too_young", "text": f"Бизнесу меньше {rules.stop_business_age_months} месяцев"})
    return stops


def _factor(id: str, title: str, value: str, points: int, explanation: str) -> dict:
    return {"id": id, "title": title, "value": value, "points": points, "explanation": explanation}


def scorecard(company: dict, f: dict, terms: dict, payment: float, avg12: float, avg3: float, revenue: float, now: datetime) -> list[dict]:
    """Факторы с баллами к базе 500."""
    registered = datetime.fromisoformat(company["registeredAt"].replace("Z", "+00:00"))
    age = months_between(registered, now)
    age_points = -80 if age < 12 else 0 if age <= 36 else 60
    age_text = (f"Бизнес работает {business_age(age)} — меньше года, история оборотов короткая." if age < 12
                else f"Бизнес работает {business_age(age)} — нейтральный срок." if age <= 36
                else f"Бизнес работает {business_age(age)} — устойчивая история.")

    pay_ratio = payment / avg3 if avg3 > 0 else math.inf
    pay_points = 120 if pay_ratio <= 0.2 else 40 if pay_ratio <= 0.35 else -60 if pay_ratio <= 0.5 else -150

    debt_ratio = (f["existingDebt"] + terms["amount"]) / revenue if revenue > 0 else math.inf
    debt_points = 100 if debt_ratio <= 0.3 else 0 if debt_ratio <= 0.6 else -100 if debt_ratio <= 1 else -200

    overdue = f["overdueClosed12m"]
    if overdue > 0:
        history = _factor("credit_history", "Кредитная история", f"закрытых просрочек: {overdue}", max(-160, -80 * overdue),
                          f"За последние 12 месяцев были просрочки ({overdue}), сейчас они закрыты.")
    elif f["existingLoans"] > 0 or f["existingDebt"] > 0:
        history = _factor("credit_history", "Кредитная история", "без просрочек", 80, "Кредиты обслуживаются без просрочек.")
    else:
        history = _factor("credit_history", "Кредитная история", "нет кредитов", 0, "Кредитов не было — оценить платёжную дисциплину нельзя.")

    change = avg3 / avg12 - 1 if avg12 > 0 else 0
    dyn_points = 50 if change >= 0.1 else 0 if change >= -0.1 else -60 if change >= -0.25 else -120
    signed = f"{'+' if change > 0 else ''}{pct(change)}"
    dyn_text = (f"Обороты за последние 3 месяца выросли на {pct(change)} к среднему за год." if change >= 0.1
                else "Обороты за последние 3 месяца на уровне среднего за год." if change >= -0.1
                else f"Обороты за последние 3 месяца снизились на {pct(-change)} к среднему за год.")

    amount_ratio = terms["amount"] / revenue if revenue > 0 else math.inf
    amount_points = 50 if amount_ratio <= 0.25 else 0 if amount_ratio <= 0.5 else -80

    def share(x: float, unknown: str = "—") -> str:
        return pct(x) if math.isfinite(x) else unknown

    return [
        _factor("age", "Срок работы бизнеса", business_age(age), age_points, age_text),
        _factor("payment_to_turnover", "Платёж / средний оборот за 3 мес", share(pay_ratio, "нет оборотов"), pay_points,
                f"Новый платёж {rub(payment)} ({src.PAYMENT_TYPE_LABEL[terms['paymentType']].lower()}) составит {pct(pay_ratio)} "
                "среднемесячного оборота за последние 3 месяца." if math.isfinite(pay_ratio) else "За последние 3 месяца нет поступлений на счёт."),
        _factor("debt_load", "Долговая нагрузка", share(debt_ratio), debt_points,
                f"Действующие кредиты ({rub(f['existingDebt'])}) и новый ({rub(terms['amount'])}) вместе составят "
                f"{share(debt_ratio, 'неизвестную долю')} годовой выручки."),
        history,
        _factor("turnover_dynamics", "Динамика оборотов", signed, dyn_points, dyn_text),
        _factor("amount_to_revenue", "Сумма кредита / выручка за 12 мес", share(amount_ratio), amount_points,
                f"Запрошенная сумма — {share(amount_ratio, 'неизвестная доля')} годовой выручки."),
    ]


# ---------------------------------------------------------------------------
# Solver: встречное предложение (автоматический конвейер)
# ---------------------------------------------------------------------------


def _make_offer(offer_id: str, title: str, terms: dict, rate: float, current: float, turnover: float, rules: Rules) -> dict:
    payment = load_payment(terms["amount"], terms["term"], rate, terms["paymentType"], terms.get("graceMonths") or 0)
    return {
        "id": offer_id, "title": title, "amount": terms["amount"], "term": terms["term"], "rate": rate,
        "paymentType": terms["paymentType"], "graceMonths": terms.get("graceMonths") or 0,
        "monthlyPayment": src.js_round(payment), "pti": round(calc_pti(current, payment, turnover, rules), 4),
    }


def _fits(terms: dict, rate: float, current: float, turnover: float, rules: Rules) -> bool:
    payment = load_payment(terms["amount"], terms["term"], rate, terms["paymentType"], terms.get("graceMonths") or 0)
    return calc_pti(current, payment, turnover, rules) < rules.pti_approve


def _fit_amount(max_payment: float, terms: dict, rate: float, current: float, turnover: float, rules: Rules) -> int:
    """Максимальная сумма (кратная шагу) на этих условиях, при которой PTI строго < pti_approve."""
    raw = max_amount_for_payment(max_payment, terms["term"], rate, terms["paymentType"], terms.get("graceMonths") or 0)
    amount = int(raw // src.AMOUNT_STEP * src.AMOUNT_STEP)
    while amount > 0 and not _fits({**terms, "amount": amount}, rate, current, turnover, rules):
        amount -= src.AMOUNT_STEP
    return amount


def solver(terms: dict, product: dict, rate: float, current: float, turnover: float, rules: Rules) -> list[dict]:
    """Подбирает условия в рамках продукта (тип платежа сохраняется), при которых PTI < pti_approve."""
    max_term = product["maxTerm"]
    max_payment = rules.pti_approve * turnover * rules.turnover_to_cashflow - current
    if max_payment <= 0:
        return []
    offers: list[dict] = []

    for t in rules.term_grid:  # вариант 1: та же сумма, срок больше
        longer = {**terms, "term": t}
        if terms["term"] < t <= max_term and _fits(longer, rate, current, turnover, rules):
            offers.append(_make_offer("extend_term", "Увеличение срока", longer, rate, current, turnover, rules))
            break

    reduced = _fit_amount(max_payment, terms, rate, current, turnover, rules)  # вариант 2: тот же срок, сумма меньше
    if reduced >= product["minAmount"]:
        offers.append(_make_offer("reduce_amount", "Снижение суммы", {**terms, "amount": reduced}, rate, current, turnover, rules))

    if not any(o["id"] == "extend_term" for o in offers) and terms["term"] < max_term:  # вариант 3: максимальный срок и сумма
        longest = {**terms, "term": max_term}
        combo = min(_fit_amount(max_payment, longest, rate, current, turnover, rules), terms["amount"])
        if combo > reduced and combo >= product["minAmount"]:
            offers.append(_make_offer("max_term", "Увеличение срока и снижение суммы", {**longest, "amount": combo}, rate, current, turnover, rules))
    return offers


# ---------------------------------------------------------------------------
# Кредитная политика (front/src/mocks/creditPolicy.ts)
# ---------------------------------------------------------------------------


def missing_docs(product: dict, documents: list[dict]) -> list[str]:
    return [t for t in product["requiredDocs"] if not any(d["docType"] == t for d in documents)]


def counter_amount(product: dict, terms: dict, avg3: float, rules: Rules) -> Optional[int]:
    """Максимальная сумма, при которой платёж ≤ 35% оборота за 3 мес; None, если даже минимум продукта не проходит."""
    raw = max_amount_for_payment(avg3 * rules.counter_payment_share, terms["term"], terms.get("rate") or product["baseRate"],
                                 terms["paymentType"], terms.get("graceMonths") or 0)
    cap = int(raw // src.AMOUNT_STEP * src.AMOUNT_STEP) if math.isfinite(raw) else terms["amount"]
    amount = min(terms["amount"], cap)
    return None if amount < product["minAmount"] else amount


def manual_reasons(scoring: dict, product: dict, terms: dict, documents: list[dict]) -> list[str]:
    reasons = []
    if scoring["zone"] == "manual":
        reasons.append("Балл в зоне ручной проверки")
    if scoring["zone"] == "high_risk":
        reasons.append("Балл в зоне высокого риска")
    if terms["amount"] > product["autoLimit"]:
        reasons.append(f"Сумма выше авто-лимита {rub(product['autoLimit'])}")
    missing = missing_docs(product, documents)
    if missing:
        reasons.append("Не хватает документов: " + ", ".join(src.DOC_TYPES[t]["short"].lower() for t in missing))
    return reasons


def recommend(scoring: dict, product: dict, terms: dict, documents: list[dict], avg3: float, rules: Rules) -> dict:
    """Рекомендация системы для специалиста — решение всё равно принимает человек."""
    reasons = manual_reasons(scoring, product, terms, documents)
    if scoring["stopFactors"]:
        return {"type": "reject", "text": f"Рекомендуем отказ: {scoring['stopFactors'][0]['text'].lower()}", "manualReasons": reasons}
    if scoring["zone"] == "high_risk":
        return {"type": "reject", "text": "Рекомендуем отказ: высокий риск по скорингу", "manualReasons": reasons}
    counter = counter_amount(product, terms, avg3, rules)
    if counter is None:
        return {"type": "reject", "text": "Рекомендуем отказ: даже минимальная сумма продукта слишком нагружает обороты", "manualReasons": reasons}
    if counter < terms["amount"]:
        return {"type": "counter_offer", "text": f"Рекомендуем встречное предложение: до {rub(counter)}", "amount": counter, "manualReasons": reasons}
    return {"type": "approve", "text": "Рекомендуем одобрить на запрошенных условиях", "manualReasons": reasons}


# ---------------------------------------------------------------------------
# Оценка заявки
# ---------------------------------------------------------------------------


def is_auto_company(inn: str) -> bool:
    """Решение демо-профилей принимает автоматический конвейер."""
    return inn in src.SCENARIOS


def _check(stage: str, name: str, passed: bool, details: str) -> dict:
    return {"stage": stage, "name": name, "passed": passed, "details": details}


def evaluate(*, company: dict, financials: dict, requested: dict, product: dict, documents: list[dict],
             rules: Rules, now: datetime, external_statement: bool = False) -> dict:
    """
    Полный расчёт по заявке: скоринг (балл, факторы, PTI) и решение.
    Возвращает {scoring, rate, outcome, reasonCode, reasonText, terms, offers, checks, recommendation, auto}.
    outcome: REJECTED | APPROVED | COUNTER_OFFER | NEED_INFO | IN_QUEUE
    """
    f, inn = financials, company["inn"]
    checks: list[dict] = []
    stops = stop_factors(company, f, now, rules)

    extra = src.EXTERNAL_STATEMENTS.get(inn, 0) if external_statement else 0
    turnover = f["avgTurnover12m"] + extra
    avg3 = f["avgTurnover3m"] + extra
    revenue = f["revenue12m"] + extra * 12

    registered = datetime.fromisoformat(company["registeredAt"].replace("Z", "+00:00"))
    checks.append(_check("gatekeeper", "ЕГРЮЛ", not any(s["code"] in ("company_liquidated", "business_too_young") for s in stops),
                         f"Статус: {'действующая' if company['status'] == 'active' else 'ликвидирована'}, "
                         f"работает {business_age(months_between(registered, now))}"))
    checks.append(_check("gatekeeper", "БКИ", not f["overdueCurrent"], "Текущая просрочка" if f["overdueCurrent"] else "Текущих просрочек нет"))

    base_payment = load_payment(requested["amount"], requested["term"], product["baseRate"], requested["paymentType"], requested.get("graceMonths") or 0)
    factors = scorecard(company, f, requested, base_payment, turnover, avg3, revenue, now)
    score = min(1000, max(0, rules.base_score + sum(x["points"] for x in factors)))
    rate = rate_for(product, score, rules)

    current = f["existingMonthlyPayments"]
    payment = load_payment(requested["amount"], requested["term"], rate, requested["paymentType"], requested.get("graceMonths") or 0)
    pti = calc_pti(current, payment, turnover, rules)
    # PTI — критерий решения, а не слагаемое балла: показываем его рядом с факторами с нулём баллов
    factors.append(_factor(
        "pti", "PTI (критерий решения)", f"{pti:.2f}", 0,
        f"({rub(current)} текущих платежей + {rub(payment)} новый) / ({rub(turnover)} × {rules.turnover_to_cashflow:g}). "
        f"Меньше {rules.pti_approve:g} — одобрение, до {rules.pti_decline:g} — встречное предложение, выше — отказ."))
    zone = zone_of(score, rules)
    scoring = {
        "score": score, "base": rules.base_score, "zone": zone, "factors": factors, "stopFactors": stops,
        "calculatedAt": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
        "modelVersion": rules.version, "confirmedTurnover": turnover,
        "debtServiceCapacity": src.js_round(turnover * rules.turnover_to_cashflow),
        "currentMonthlyPayments": current, "newMonthlyPayment": src.js_round(payment),
        "pti": round(pti, 4) if math.isfinite(pti) else 99.0,
    }

    result = {"scoring": scoring, "rate": rate, "reasonCode": None, "reasonText": None, "terms": None, "offers": [], "auto": is_auto_company(inn)}

    def done(outcome: str, reason: Optional[str] = None, offers: Optional[list[dict]] = None) -> dict:
        result.update(outcome=outcome, reasonCode=reason, offers=offers or [], checks=checks)
        result["terms"] = {**requested, "rate": rate} if outcome == "APPROVED" else None
        return result

    if result["auto"]:
        return _auto_decision(result, stops, requested, product, rules, turnover, current, extra > 0, checks, done)

    # Политика банка: решение принимает человек, кроме явных случаев
    result["recommendation"] = recommend(scoring, product, requested, documents, avg3, rules)
    checks.append(_check("brain", "Скоринг", score >= rules.high_risk_score, f"{score} баллов"))
    checks.append(_check("brain", "PTI", pti < rules.pti_approve, f"PTI = {pti:.3f}"))
    if stops:
        return done("REJECTED", stops[0]["code"])
    can_auto = score >= rules.auto_score and requested["amount"] <= product["autoLimit"] and not missing_docs(product, documents)
    return done("APPROVED") if can_auto else done("IN_QUEUE")


def _auto_decision(result: dict, stops: list[dict], requested: dict, product: dict, rules: Rules, turnover: float,
                   current: float, statement_uploaded: bool, checks: list[dict], done) -> dict:
    """Автоматический конвейер: Quality Check → Brain → Solver."""
    scoring = result["scoring"]
    score, pti, rate = scoring["score"], scoring["pti"], result["rate"]

    need_info = False
    if not stops:
        source = "DWH банка + выписка" if statement_uploaded else "DWH банка"
        limit = turnover * rules.max_amount_to_turnover
        need_info = requested["amount"] > limit
        details = (f"Сумма {rub(requested['amount'])} > {rules.max_amount_to_turnover:g} × оборот {rub(turnover)}/мес ({source})"
                   if need_info else f"Оборот {rub(turnover)}/мес ({source})")
        checks.append(_check("quality_check", "Сверка оборотов", not need_info, details))
    checks.append(_check("brain", "Скоринг", score >= rules.high_risk_score,
                         f"{score} баллов{', ставка −1 п.п.' if rate < product['baseRate'] else ''}"))
    checks.append(_check("brain", "PTI", pti < rules.pti_approve, f"PTI = {pti:.3f}"))

    outcome, reason, offers = _auto_outcome(stops, need_info, score, pti, requested, product, rate, current, turnover, rules, checks)
    result["reasonText"] = AUTO_REASON_TEXT.get(reason) if reason else None
    result["recommendation"] = _auto_recommendation(outcome, reason, offers, scoring, result["reasonText"])
    return done(outcome, reason, offers)


def _auto_outcome(stops, need_info, score, pti, requested, product, rate, current, turnover, rules, checks):
    if stops:
        return "REJECTED", stops[0]["code"], []
    if need_info:
        return "NEED_INFO", "need_bank_statement", []
    if score < rules.high_risk_score:
        return "REJECTED", "high_risk_score", []
    if pti < rules.pti_approve:
        return "APPROVED", None, []
    if pti >= rules.pti_decline:
        return "REJECTED", "high_debt_load", []
    offers = solver(requested, product, rate, current, turnover, rules)
    if not offers:
        checks.append(_check("solver", "Контр-оффер", False, f"Нет условий с PTI < {rules.pti_approve:g}"))
        return "REJECTED", "low_turnover", []
    checks.append(_check("solver", "Контр-оффер", True, f"Вариантов: {len(offers)}"))
    return "COUNTER_OFFER", None, offers


AUTO_REASON_TEXT = {
    "company_liquidated": "По данным ЕГРЮЛ компания находится в стадии ликвидации, поэтому кредит на неё оформить нельзя.",
    "overdue_current": "По данным кредитной истории сейчас есть непогашенная просрочка.",
    "business_too_young": f"Бизнесу меньше {src.STOP_BUSINESS_AGE_MONTHS} месяцев — истории оборотов недостаточно.",
    "high_risk_score": f"Балл скоринга ниже {Rules.high_risk_score} — зона высокого риска.",
    "high_debt_load": "Долговая нагрузка (PTI) с новым кредитом превышает допустимый уровень.",
    "low_turnover": "Текущие платежи по кредитам уже исчерпывают допустимую долговую нагрузку.",
    "need_bank_statement": ("Запрошенная сумма превышает обороты по счёту в банке. "
                            "Загрузите выписку из другого банка, чтобы подтвердить выручку."),
}


def _auto_recommendation(outcome: str, reason: Optional[str], offers: list[dict], scoring: dict, reason_text: Optional[str]) -> dict:
    s = f"{scoring['score']} баллов, PTI {scoring['pti']:.2f}"
    if outcome == "APPROVED":
        return {"type": "approve", "text": f"Конвейер: одобрить ({s})", "manualReasons": []}
    if outcome == "COUNTER_OFFER":
        return {"type": "counter_offer", "text": f"Конвейер: встречное предложение до {rub(offers[0]['amount'])} ({s})",
                "amount": offers[0]["amount"], "manualReasons": []}
    if outcome == "NEED_INFO":
        return {"type": "approve", "text": f"Конвейер: обороты не подтверждены, нужна выписка ({s})", "manualReasons": [reason_text] if reason_text else []}
    return {"type": "reject", "text": f"Конвейер: отказ — {src.reject_reason(reason)['title'].lower()} ({s})", "manualReasons": []}
