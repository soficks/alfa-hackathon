"""
Жизненный цикл заявки: создание, отправка, авто-проверки, действия клиента и сотрудника.

Порт front/src/mocks/operations.ts: операции меняют агрегат заявки (dict в форме типа Application фронта)
и дописывают событие в историю. Сохраняет заявку вызывающий код (main.py / seed.py) в одной транзакции.

Любое изменение статуса идёт через move_to и таблицу TRANSITIONS (front/src/domain/stateMachine.ts).
Пересчёт скоринга всегда идёт по версии правил заявки (modelVersion) и пишется в scoringHistory + history.
"""

from __future__ import annotations

import random
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import db as store
import engine
import sources as src
from sources import ApiError

# ---------------------------------------------------------------------------
# Время и идентификаторы
# ---------------------------------------------------------------------------

SYSTEM = {"role": "system", "name": "Система"}
_seq = 0


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def uid(prefix: str) -> str:
    global _seq
    _seq += 1
    return f"{prefix}-{int(time.time() * 1000):x}{_seq:x}{random.randrange(36 ** 4):04x}"


def add_business_days(frm: datetime, days: int) -> datetime:
    d, left = frm, days
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return d


_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]


def full_date(s: str) -> str:
    d = parse_iso(s)
    return f"{d.day} {_MONTHS_GEN[d.month - 1]} {d.year} г."


def actor_of(user: dict) -> dict:
    return {"role": user["role"], "id": user["id"], "name": f"{user['firstName']} {user['lastName']}"}


# ---------------------------------------------------------------------------
# Статусы (front/src/domain/stateMachine.ts)
# ---------------------------------------------------------------------------

TRANSITIONS: dict[str, list[str]] = {
    "DRAFT": ["SUBMITTED"],
    "SUBMITTED": ["AUTO_CHECKS"],
    "AUTO_CHECKS": ["APPROVED", "COUNTER_OFFER", "NEED_INFO", "REJECTED", "IN_QUEUE"],
    "IN_QUEUE": ["IN_REVIEW", "AUTO_CHECKS", "WITHDRAWN"],
    "IN_REVIEW": ["NEED_INFO", "APPROVED", "COUNTER_OFFER", "REJECTED", "WITHDRAWN"],
    "NEED_INFO": ["IN_REVIEW", "AUTO_CHECKS", "WITHDRAWN"],
    "APPROVED": ["SIGNING"],
    "COUNTER_OFFER": ["SIGNING", "DECLINED_BY_CLIENT"],
    "SIGNING": ["ISSUED"],
    "ISSUED": [], "REJECTED": [], "DECLINED_BY_CLIENT": [], "WITHDRAWN": [],
}
FINAL_STATUSES = ("ISSUED", "REJECTED", "DECLINED_BY_CLIENT", "WITHDRAWN")
EDITABLE_STATUSES = ("IN_QUEUE", "IN_REVIEW", "NEED_INFO")


def is_checking(status: str) -> bool:
    return status in ("SUBMITTED", "AUTO_CHECKS")


def can_message(status: str) -> bool:
    return status != "DRAFT" and status not in FINAL_STATUSES


def move_to(app: dict, to: str, at: datetime) -> dict:
    if to not in TRANSITIONS[app["status"]]:
        raise ApiError(409, f"Недопустимый переход заявки: {app['status']} → {to}")
    app["status"] = to
    app["updatedAt"] = iso(at)
    return app


def with_event(app: dict, at: datetime, actor: dict, type: str, text: str, visible: bool = True, client_text: Optional[str] = None) -> dict:
    event = {"id": uid("ev"), "at": iso(at), "actor": actor["role"], "actorName": actor["name"], "type": type, "text": text,
             "visibleToClient": visible}
    if client_text:
        event["clientText"] = client_text
    app["updatedAt"] = iso(at)
    app["history"].append(event)
    return app


def open_requests(app: dict) -> list[dict]:
    return [r for r in app["docRequests"] if not r.get("fulfilledByDocId")]


def final_terms(app: dict) -> dict:
    return (app.get("decision") or {}).get("terms") or app["requested"]


def product_of(app: dict) -> dict:
    return src.PRODUCTS[app["productId"]]


def terms_text(t: dict) -> str:
    grace = f" ({t['graceMonths']} мес.)" if t.get("graceMonths") else ""
    return f"{engine.rub(t['amount'])} на {engine.months(t['term'])}, {t['rate']}% · {src.PAYMENT_TYPE_LABEL[t['paymentType']].lower()}{grace}"


# ---------------------------------------------------------------------------
# Черновик
# ---------------------------------------------------------------------------


def blank_application(app_id: str, owner_id: str, company: dict, goal_id: str, at: datetime, model_version: str) -> dict:
    product = src.PRODUCTS[src.GOAL_PRODUCT[goal_id]]
    return {
        "id": app_id, "ownerUserId": owner_id, "company": company, "goalId": goal_id, "productId": product["id"],
        "requested": {"amount": product["minAmount"], "term": product["minTerm"], "rate": product["baseRate"], "paymentType": product["paymentTypes"][0]},
        "indicativeRate": product["baseRate"], "modelVersion": model_version, "status": "DRAFT",
        "createdAt": iso(at), "updatedAt": iso(at), "documents": [], "docRequests": [],
        "consents": {"bki": False, "personalData": False, "authority": False}, "checks": [], "messages": [], "history": [],
        "version": 1, "changes": [], "scoringHistory": [],
    }


def apply_draft(app: dict, w: dict, at: datetime) -> dict:
    """Перенести данные мастера в заявку-черновик."""
    goal_id = w.get("goalId") or app["goalId"]
    if goal_id not in src.GOAL_PRODUCT:
        raise ApiError(422, f"Неизвестная цель: {goal_id}")
    product = src.PRODUCTS[src.GOAL_PRODUCT[goal_id]]
    requested = {**w.get("requested", app["requested"]), "rate": product["baseRate"]}
    if requested.get("paymentType") != "annuity_grace":
        requested.pop("graceMonths", None)
    app.update(goalId=goal_id, productId=product["id"], requested=requested, indicativeRate=product["baseRate"], updatedAt=iso(at))
    if w.get("company"):
        app["company"] = w["company"]
    for key in ("subgoalId", "contactPerson", "financials"):
        if key in w:
            if w[key] is None:
                app.pop(key, None)
            else:
                app[key] = w[key]
    if "documents" in w:
        app["documents"] = [{**d, "addedBy": d.get("addedBy", "client"), "source": d.get("source", "submission")} for d in w["documents"]]
    if "consents" in w:
        app["consents"] = w["consents"]
    if "step" in w:
        app["draftStep"] = w["step"]
    return app


# ---------------------------------------------------------------------------
# Отправка и авто-проверки
# ---------------------------------------------------------------------------

STEP_IDS = ["registry", "bki", "statement", "scoring", "decision"]
PIPELINE_TITLES = {
    "registry": "Сверяем реквизиты в ЕГРЮЛ", "bki": "Запрашиваем кредитную историю", "statement": "Анализируем выписку",
    "scoring": "Оцениваем заявку", "decision": "Определяем, кто примет решение",
}


def step_delay() -> timedelta:
    return timedelta(milliseconds=450 + random.randrange(200))


def fresh_pipeline(at: datetime) -> dict:
    return {"steps": [{"id": i, "title": PIPELINE_TITLES[i], "status": "pending"} for i in STEP_IDS], "nextAt": iso(at + timedelta(milliseconds=500))}


def validate_terms(product: dict, t: dict) -> Optional[str]:
    if t["amount"] < product["minAmount"] or t["amount"] > product["maxAmount"]:
        return f"Сумма должна быть от {engine.rub(product['minAmount'])} до {engine.rub(product['maxAmount'])}"
    if t["term"] < product["minTerm"] or t["term"] > product["maxTerm"]:
        return f"Срок должен быть от {product['minTerm']} до {product['maxTerm']} мес."
    if t["paymentType"] not in product["paymentTypes"]:
        return "Этот тип платежа недоступен для продукта"
    if t["rate"] <= 0 or t["rate"] > 60:
        return "Проверьте ставку"
    if t["paymentType"] == "annuity_grace":
        grace = t.get("graceMonths") or 0
        if grace < 1 or grace > product.get("maxGraceMonths", 0) or grace >= t["term"]:
            return f"Отсрочка — от 1 до {product.get('maxGraceMonths', 0)} мес."
    return None


def submit(app: dict, at: datetime, actor: dict) -> dict:
    c = app["consents"]
    if not (c.get("bki") and c.get("personalData") and c.get("authority")):
        raise ApiError(400, "Нужны все три согласия, чтобы отправить заявку")
    if not app.get("financials"):
        raise ApiError(400, "Загрузите выписку по счёту")
    invalid = validate_terms(product_of(app), app["requested"])
    if invalid:
        raise ApiError(422, invalid)
    move_to(app, "SUBMITTED", at)
    app.update(submittedAt=iso(at), pipeline=fresh_pipeline(at))
    app["consents"] = {**c, "at": iso(at)}
    app.pop("draftStep", None)
    return with_event(app, at, actor, "submitted", "Заявка поступила", client_text="Заявка отправлена")


def restart_checks(app: dict, at: datetime, actor: dict, reason: str) -> dict:
    move_to(app, "AUTO_CHECKS", at)
    app["pipeline"] = fresh_pipeline(at)
    return with_event(app, at, actor, "auto_restarted", f"Повторные авто-проверки: {reason}",
                      client_text="Данные изменились — проверяем заявку заново")


def registry_lookup(c: sqlite3.Connection, inn: str, at: Optional[datetime] = None) -> dict:
    """Запрос в ЕГРЮЛ/ЕГРИП. Ответ реестра сохраняется в БД, поэтому дата регистрации не «плывёт» между запросами."""
    inn = inn.strip()
    cached = store.get_company(c, inn)
    if cached:
        return cached
    company = src.egrul_lookup(inn, at)
    store.upsert_company(c, company)
    return company


def registry_checks(company: dict, from_registry: dict, at: datetime) -> list[dict]:
    age = engine.months_between(parse_iso(from_registry["registeredAt"]), at)
    registry = {
        "id": "registry", "title": "ЕГРЮЛ / ЕГРИП",
        "status": "fail" if from_registry["status"] == "liquidated" else "warn" if age < src.MIN_BUSINESS_AGE_MONTHS else "ok",
        "details": [
            f"Статус: {'действующая' if from_registry['status'] == 'active' else 'ликвидирована'}",
            f"Дата регистрации: {full_date(from_registry['registeredAt'])} ({engine.business_age(age)})",
            f"ОКВЭД {from_registry['okved']} — {from_registry['okvedName']}",
        ],
    }
    inn_ok = src.is_valid_inn(company["inn"])
    ogrn_ok = src.is_valid_registration_number(company["ogrn"], company["form"])
    matches = company["ogrn"] == from_registry["ogrn"] and company["name"] == from_registry["name"]
    requisites = {
        "id": "requisites", "title": "Реквизиты", "status": "ok" if inn_ok and ogrn_ok and matches else "fail",
        "details": [
            "ИНН: контрольное число сходится" if inn_ok else "ИНН: контрольное число не сходится",
            f"{'ОГРНИП' if company['form'] == 'ИП' else 'ОГРН'}: контрольное число сходится" if ogrn_ok else "ОГРН: контрольное число не сходится",
            "Название и ОГРН совпадают с реестром" if matches else "Данные заявки расходятся с реестром",
        ],
    }
    return [registry, requisites]


def documents_check(app: dict) -> dict:
    product = product_of(app)
    missing = engine.missing_docs(product, app["documents"])
    return {"id": "documents", "title": "Комплектность документов", "status": "warn" if missing else "ok",
            "details": [f"{src.DOC_TYPES[t]['title']}: {'нет' if t in missing else 'есть'}" for t in product["requiredDocs"]]}


def set_check(app: dict, check: dict) -> None:
    app["checks"] = [x for x in app["checks"] if x["id"] != check["id"]] + [check]


def complete_step(app: dict, step_id: str, at: datetime, status: str = "done") -> None:
    p = app.get("pipeline")
    if not p:
        return
    for s in p["steps"]:
        if s["id"] == step_id:
            s["status"], s["doneAt"] = status, iso(at)
    p["nextAt"] = iso(at + step_delay())


def empty_financials() -> dict:
    return {"revenue12m": 0, "avgTurnover12m": 0, "avgTurnover3m": 0, "turnoverByMonth": [], "existingDebt": 0,
            "existingMonthlyPayments": 0, "existingLoans": 0, "overdueCurrent": False, "overdueClosed12m": 0}


def has_external_statement(app: dict) -> bool:
    """Выписку из другого банка по запросу системы уже загрузили."""
    return any(r["createdBy"] == SYSTEM["name"] and r["docType"] == "bank_statement" and r.get("fulfilledByDocId") for r in app["docRequests"])


def evaluate_app(app: dict, at: datetime) -> dict:
    """Расчёт по правилам той версии, с которой создана заявка."""
    return engine.evaluate(
        company=app["company"], financials=app["financials"], requested=app["requested"], product=product_of(app),
        documents=app["documents"], rules=engine.rules_for(app.get("modelVersion")), now=at, external_statement=has_external_statement(app))


def record_external(app: dict, source: str, inn: str, at: datetime, payload: dict) -> None:
    """Что запросили у внешнего источника; строка попадёт в external_data при сохранении заявки."""
    app.setdefault("externalData", []).append({"source": source, "inn": inn, "requestedAt": iso(at), "payload": payload})


def record_scoring(app: dict, ev: dict, trigger: str, at: datetime) -> dict:
    s = ev["scoring"]
    entry = {
        "id": uid("scr"), "calculatedAt": s["calculatedAt"], "trigger": trigger, "modelVersion": s["modelVersion"],
        "score": s["score"], "pti": s["pti"], "zone": s["zone"], "outcome": ev["outcome"], "amount": app["requested"]["amount"],
        "term": app["requested"]["term"], "paymentType": app["requested"]["paymentType"], "rate": ev["rate"], "scoring": s,
    }
    app.setdefault("scoringHistory", []).append(entry)
    return entry


def pipeline_tick(c: sqlite3.Connection, app: dict, at: datetime) -> dict:
    """Один шаг авто-проверок. Возвращает заявку без изменений, если делать нечего."""
    if app["status"] == "SUBMITTED":
        move_to(app, "AUTO_CHECKS", at)
        return with_event(app, at, SYSTEM, "auto_started", "Начаты автоматические проверки")
    if app["status"] != "AUTO_CHECKS" or not app.get("pipeline"):
        return app
    step = next((s for s in app["pipeline"]["steps"] if s["status"] == "pending"), None)
    if not step:
        return app
    inn = app["company"]["inn"]

    if step["id"] == "registry":
        from_registry = registry_lookup(c, inn, at)
        for check in registry_checks(app["company"], from_registry, at):
            set_check(app, check)
        ok = from_registry["status"] == "active"
        app["company"] = {**app["company"], "status": from_registry["status"]}
        record_external(app, "egrul", inn, at, from_registry)
        complete_step(app, "registry", at, "done" if ok else "fail")
        return with_event(app, at, SYSTEM, "registry", "Реквизиты подтверждены в ЕГРЮЛ" if ok else "По данным ЕГРЮЛ компания ликвидирована")

    if step["id"] == "bki":
        r = src.bki_report(inn)
        prev = app.get("financials")
        app["financials"] = {
            **(prev or empty_financials()), "existingLoans": r["loans"],
            "existingDebt": prev["existingDebt"] if prev else r["totalDebt"],
            "existingMonthlyPayments": prev["existingMonthlyPayments"] if prev else r["monthlyPayments"],
            "overdueCurrent": r["overdueCurrent"], "overdueClosed12m": r["overdueClosed12m"],
        }
        set_check(app, {
            "id": "bki", "title": "Кредитная история (БКИ)",
            "status": "fail" if r["overdueCurrent"] else "warn" if r["overdueClosed12m"] else "ok",
            "details": [f"Действующих кредитов: {r['loans']}, долг {engine.rub(r['totalDebt'])}",
                        f"Платежи по ним: {engine.rub(r['monthlyPayments'])} в месяц",
                        "Есть текущая просрочка" if r["overdueCurrent"] else "Текущих просрочек нет",
                        f"Закрытых просрочек за 12 мес: {r['overdueClosed12m']}"],
        })
        record_external(app, "bki", inn, at, r)
        complete_step(app, "bki", at, "fail" if r["overdueCurrent"] else "done")
        return with_event(app, at, SYSTEM, "bki", "Получена кредитная история")

    if step["id"] == "statement":
        f = app.get("financials") or empty_financials()
        if not f["turnoverByMonth"]:
            s = src.analyze_statement(inn)
            f = {**f, **{k: s[k] for k in ("revenue12m", "avgTurnover12m", "avgTurnover3m", "turnoverByMonth")}}
        app["financials"] = f
        record_external(app, "dwh", inn, at, {k: f[k] for k in ("revenue12m", "avgTurnover12m", "avgTurnover3m")})
        complete_step(app, "statement", at)
        return with_event(app, at, SYSTEM, "statement", f"Проанализирована выписка: средний оборот за 3 мес — {engine.rub(f['avgTurnover3m'])}",
                          client_text="Проанализирована выписка")

    if step["id"] == "scoring":
        ev = evaluate_app(app, at)
        app["scoring"] = ev["scoring"]
        set_check(app, documents_check(app))
        record_scoring(app, ev, "checks", at)
        complete_step(app, "scoring", at)
        return with_event(app, at, SYSTEM, "scoring", f"Скоринг: {ev['scoring']['score']} баллов, PTI {ev['scoring']['pti']:.2f} ({ev['scoring']['modelVersion']})",
                          visible=False)

    complete_step(app, "decision", at)  # decision
    return apply_outcome(app, evaluate_app(app, at), at)


def _terms_of(t: dict) -> dict:
    terms = {"amount": t["amount"], "term": t["term"], "rate": t["rate"], "paymentType": t["paymentType"]}
    if t["paymentType"] == "annuity_grace":
        terms["graceMonths"] = t.get("graceMonths")
    return terms


def apply_outcome(app: dict, ev: dict, at: datetime) -> dict:
    """Шаг «решение»: результат движка → статус, решение и события в истории."""
    s, outcome = ev["scoring"], ev["outcome"]
    app["recommendation"] = ev["recommendation"]
    brief = f"{s['score']} баллов, PTI {s['pti']:.2f}"
    justification = ("Конвейер: " + "; ".join(f"{x['name']} — {x['details']}" for x in ev["checks"])) if ev["auto"] else None

    if outcome == "REJECTED":
        reason = src.reject_reason(ev["reasonCode"])
        move_to(app, "REJECTED", at)
        app["decision"] = {
            "type": "reject", "reasonCode": reason["code"],
            "justification": (f"{justification}. {ev['reasonText']}" if ev["reasonText"] else justification) if ev["auto"]
            else "Стоп-фактор: " + "; ".join(x["text"].lower() for x in s["stopFactors"]),
            "clientMessage": reason["clientMessage"], "decidedBy": "system", "decidedAt": iso(at),
        }
        text = f"Авто-отказ: {reason['title'].lower()}" if ev["auto"] else f"Авто-отказ: {s['stopFactors'][0]['text'].lower()}"
        return with_event(app, at, SYSTEM, "decision", text, client_text="Решение: отказ")

    if outcome == "APPROVED":
        move_to(app, "APPROVED", at)
        app["decision"] = {
            "type": "approve", "terms": _terms_of(ev["terms"]),
            "justification": justification or f"Авто-одобрение: {s['score']} баллов, сумма в пределах авто-лимита, документы в комплекте.",
            "clientMessage": "Заявка одобрена автоматически. Проверьте условия и подтвердите их.",
            "decidedBy": "system", "decidedAt": iso(at), "validUntil": iso(at + timedelta(days=src.OFFER_VALID_DAYS)),
        }
        with_event(app, at, SYSTEM, "auto_result", f"Авто-проверки: {brief}, авто-одобрение", visible=False)
        return with_event(app, at, SYSTEM, "decision", "Решение системы: одобрено", client_text="Заявка одобрена")

    if outcome == "COUNTER_OFFER":
        offer, *rest = ev["offers"]
        alternatives = " или ".join(f"{engine.rub(o['amount'])} на {engine.months(o['term'])}" for o in rest)
        move_to(app, "COUNTER_OFFER", at)
        app["decision"] = {
            "type": "counter_offer", "terms": _terms_of(offer), "offers": ev["offers"],
            "justification": f"{justification}; {offer['title']}: PTI {offer['pti']:.2f}",
            "clientMessage": (f"На запрошенных условиях платёж слишком нагружает обороты. Можем выдать {engine.rub(offer['amount'])} "
                              f"на {engine.months(offer['term'])} — платёж {engine.rub(offer['monthlyPayment'])} в месяц."
                              + (f" Также доступно: {alternatives} — напишите в чат, если удобнее этот вариант." if alternatives else "")),
            "decidedBy": "system", "decidedAt": iso(at), "validUntil": iso(at + timedelta(days=src.OFFER_VALID_DAYS)),
        }
        with_event(app, at, SYSTEM, "auto_result", f"Конвейер: {brief}, встречное предложение", visible=False)
        return with_event(app, at, SYSTEM, "decision", f"Решение системы: встречное предложение ({terms_text(app['decision']['terms'])})",
                          client_text="Банк предложил другие условия")

    if outcome == "NEED_INFO":
        move_to(app, "NEED_INFO", at)
        app["docRequests"].append({
            "id": uid("req"), "docType": "bank_statement", "comment": ev["reasonText"] or "Нужна выписка из другого банка, чтобы подтвердить выручку.",
            "dueAt": iso(add_business_days(at, src.DOC_REQUEST_DAYS)), "createdAt": iso(at), "createdBy": SYSTEM["name"], "seenByClient": False,
        })
        return with_event(app, at, SYSTEM, "docs_requested", "Система запросила выписку из другого банка", client_text="Нужна выписка из другого банка")

    # IN_QUEUE
    move_to(app, "IN_QUEUE", at)
    app["slaDueAt"] = app.get("slaDueAt") or iso(add_business_days(at, src.SLA_BUSINESS_DAYS))
    reasons = "; ".join(ev["recommendation"]["manualReasons"]).lower()
    with_event(app, at, SYSTEM, "auto_result", f"Авто-проверки: {brief}, ручная проверка ({reasons})", visible=False)
    return with_event(app, at, SYSTEM, "queued", "Заявка передана специалисту", client_text="Заявку проверит специалист")


def run_checks_sync(c: sqlite3.Connection, app: dict, at: datetime) -> dict:
    """Прогнать все шаги сразу — для сида и тестов."""
    t = at
    for _ in range(12):
        if not is_checking(app["status"]):
            break
        t += timedelta(milliseconds=600)
        pipeline_tick(c, app, t)
    return app


# ---------------------------------------------------------------------------
# Пересчёт скоринга
# ---------------------------------------------------------------------------

TRIGGER_TEXT = {
    "client_changed": "клиент изменил данные", "documents": "клиент загрузил документы",
    "employee": "пересчёт сотрудником", "checks": "авто-проверки",
}


def rescore(app: dict, at: datetime, actor: dict = SYSTEM, trigger: str = "employee") -> dict:
    """Пересчёт по текущим данным и той же версии правил; результат пишется в scoringHistory и историю заявки."""
    if not app.get("financials"):
        return app
    before = (app.get("scoring") or {}).get("score")
    ev = evaluate_app(app, at)
    app["scoring"], app["recommendation"] = ev["scoring"], ev["recommendation"]
    set_check(app, documents_check(app))
    record_scoring(app, ev, trigger, at)
    s = ev["scoring"]
    head = f"Скоринг: {s['score']} баллов" if before is None else f"Скоринг пересчитан: {s['score']} баллов (было {before})"
    return with_event(app, at, actor, "rescored", f"{head}, PTI {s['pti']:.2f}, модель {s['modelVersion']} — {TRIGGER_TEXT.get(trigger, trigger)}", visible=False)


# ---------------------------------------------------------------------------
# Работа сотрудника
# ---------------------------------------------------------------------------


def take_to_work(app: dict, employee: dict, at: datetime) -> dict:
    move_to(app, "IN_REVIEW", at)
    app.update(assigneeId=employee["id"], assignedAt=iso(at), assignedEmployeeId=employee["id"])
    return with_event(app, at, employee, "taken", f"Заявка взята в работу: {employee['name']}", client_text="Заявку взял в работу специалист")


def request_documents(app: dict, employee: dict, items: list[dict], due_at: datetime, at: datetime) -> dict:
    if not items:
        raise ApiError(400, "Выберите хотя бы один документ")
    for i in items:
        if i["docType"] not in src.DOC_TYPES:
            raise ApiError(422, f"Неизвестный тип документа: {i['docType']}")
    move_to(app, "NEED_INFO", at)
    app["docRequests"] += [{
        "id": uid("req"), "docType": i["docType"], "comment": (i.get("comment") or "").strip(), "dueAt": iso(due_at),
        "createdAt": iso(at), "createdBy": employee["name"], "seenByClient": False,
    } for i in items]
    titles = ", ".join(src.DOC_TYPES[i["docType"]]["title"].lower() for i in items)
    return with_event(app, at, employee, "docs_requested", f"Запрошены документы: {titles}", client_text=f"Специалист запросил документы: {titles}")


def make_decision(app: dict, employee: dict, inp: dict, at: datetime) -> dict:
    if len((inp.get("justification") or "").strip()) < 20:
        raise ApiError(400, "Обоснование — не меньше 20 символов")
    invalid = validate_terms(product_of(app), inp["terms"])
    if invalid:
        raise ApiError(422, invalid)
    approve = inp["type"] == "approve"
    move_to(app, "APPROVED" if approve else "COUNTER_OFFER", at)
    app["decision"] = {
        "type": inp["type"], "terms": _terms_of(inp["terms"]), "justification": inp["justification"].strip(),
        "clientMessage": (inp.get("clientMessage") or "").strip()
        or ("Заявка одобрена. Проверьте условия и подтвердите их." if approve else "Мы можем выдать кредит на других условиях — посмотрите предложение."),
        "decidedBy": employee["name"], "decidedById": employee["id"], "decidedAt": iso(at),
        "validUntil": iso(at + timedelta(days=inp.get("validDays", src.OFFER_VALID_DAYS))),
    }
    t = inp["terms"]
    summary = f"{engine.rub(t['amount'])}, {engine.months(t['term'])}, {t['rate']}%"
    return with_event(app, at, employee, "decision", f"Решение: одобрено ({summary})" if approve else f"Решение: встречное предложение ({summary})",
                      client_text="Заявка одобрена" if approve else "Банк предложил другие условия")


def reject_application(app: dict, employee: dict, inp: dict, at: datetime) -> dict:
    if len((inp.get("justification") or "").strip()) < 20:
        raise ApiError(400, "Обоснование — не меньше 20 символов")
    if not (inp.get("clientMessage") or "").strip():
        raise ApiError(400, "Напишите сообщение клиенту")
    reason = src.reject_reason(inp.get("reasonCode"))
    move_to(app, "REJECTED", at)
    app["decision"] = {
        "type": "reject", "reasonCode": reason["code"], "justification": inp["justification"].strip(),
        "clientMessage": inp["clientMessage"].strip(), "decidedBy": employee["name"], "decidedById": employee["id"], "decidedAt": iso(at),
    }
    return with_event(app, at, employee, "decision", f"Решение: отказ — {reason['title'].lower()}", client_text="Решение: отказ")


def acknowledge_changes(app: dict, employee: dict, at: datetime) -> dict:
    app["changedSinceReview"] = False
    return with_event(app, at, employee, "changes_ack", "Сотрудник ознакомился с изменениями", visible=False)


# ---------------------------------------------------------------------------
# Действия клиента
# ---------------------------------------------------------------------------


def add_documents(app: dict, client: dict, files: list[dict], at: datetime, request_id: Optional[str] = None) -> dict:
    """Загрузка документов. request_id — закрыть конкретный запрос (только документом его типа)."""
    if not files:
        return app
    if app["status"] not in EDITABLE_STATUSES:
        raise ApiError(409, "Сейчас документы к заявке добавить нельзя")
    for f in files:
        if f.get("docType") not in src.DOC_TYPES:
            raise ApiError(422, f"Неизвестный тип документа: {f.get('docType')}")
    added = []
    for f in files:
        if request_id:
            target = next((r for r in app["docRequests"] if r["id"] == request_id), None)
            if not target or target.get("fulfilledByDocId"):
                raise ApiError(409, "Запрос уже закрыт")
            if target["docType"] != f["docType"]:
                raise ApiError(409, f"Этот запрос закрывается только документом «{src.DOC_TYPES[target['docType']]['title']}»")
        else:
            target = next((r for r in app["docRequests"] if not r.get("fulfilledByDocId") and r["docType"] == f["docType"]), None)
        doc = {"id": f.get("id") or uid("doc"), "name": f["name"], "size": f.get("size", 0), "docType": f["docType"],
               "addedAt": f.get("addedAt") or iso(at), "addedBy": "client", "source": "request" if target else "later"}
        if f.get("demo"):
            doc["demo"] = True
        added.append(doc)
        if target:
            target["fulfilledByDocId"], target["fulfilledAt"] = doc["id"], iso(at)
            request_id = None
    app["documents"] += added
    set_check(app, documents_check(app))
    names = ", ".join(src.DOC_TYPES[d["docType"]]["title"].lower() for d in added)
    with_event(app, at, client, "client_docs", f"Клиент загрузил: {names}", client_text=f"Вы загрузили: {names}")

    status, no_open = app["status"], not open_requests(app)
    if status == "NEED_INFO" and no_open and not app.get("assigneeId"):
        return restart_checks(app, at, client, "клиент загрузил запрошенные документы")  # запрашивала система
    if status == "IN_QUEUE":
        return restart_checks(app, at, client, "добавлены документы")
    if status == "NEED_INFO" and no_open:
        move_to(app, "IN_REVIEW", at)
        app["newDocsForEmployee"] = True
        with_event(app, at, client, "client_answered", "Клиент ответил на все запросы — заявка снова у специалиста",
                   client_text="Все запрошенные документы получены — заявка снова у специалиста")
    else:
        app["newDocsForEmployee"] = True
    return rescore(app, at, SYSTEM, "documents")


def send_message(app: dict, author: dict, text: str, at: datetime) -> dict:
    if not can_message(app["status"]):
        raise ApiError(409, "Переписка по этой заявке закрыта")
    if author["role"] == "system":
        raise ApiError(403, "Система не пишет сообщения")
    body = text.strip()
    if not body:
        return app
    app["updatedAt"] = iso(at)
    app["messages"].append({
        "id": uid("msg"), "author": author["role"], "authorName": author["name"], "text": body, "createdAt": iso(at),
        "readByClient": author["role"] == "client", "readByEmployee": author["role"] == "employee",
    })
    return app


def mark_seen(app: dict, role: str) -> dict:
    for m in app["messages"]:
        m["readByClient" if role == "client" else "readByEmployee"] = True
    if role == "client":
        for r in app["docRequests"]:
            r["seenByClient"] = True
    return app


FIELD_LABEL = {
    "amount": "сумму", "term": "срок", "paymentType": "тип платежа", "graceMonths": "отсрочку", "revenue12m": "выручку за 12 мес",
    "existingDebt": "долг по действующим кредитам", "existingMonthlyPayments": "платежи по действующим кредитам",
}
MONEY_FIELDS = ("amount", "revenue12m", "existingDebt", "existingMonthlyPayments")


def _fmt_field(field: str, v) -> str:
    if v is None:
        return "—"
    if field == "term":
        return engine.months(int(v))
    if field == "graceMonths":
        return f"{v} мес."
    if field == "paymentType":
        return src.PAYMENT_TYPE_LABEL[v]
    return engine.rub(float(v)) if field in MONEY_FIELDS else str(v)


def update_by_client(app: dict, client: dict, patch: dict, at: datetime) -> dict:
    """Клиент меняет условия или финансы после отправки: пересчёт по той же версии правил, запись в историю."""
    if app["status"] not in EDITABLE_STATUSES:
        raise ApiError(409, "Сейчас условия заявки изменить нельзя")
    requested = {**app["requested"], **(patch.get("requested") or {})}
    if requested["paymentType"] != "annuity_grace":
        requested.pop("graceMonths", None)
    invalid = validate_terms(product_of(app), requested)
    if invalid:
        raise ApiError(422, invalid)
    old_f = app.get("financials")
    allowed_f = ("revenue12m", "existingDebt", "existingMonthlyPayments")
    financials = {**old_f, **{k: v for k, v in (patch.get("financials") or {}).items() if k in allowed_f}} if old_f else old_f

    diffs = [(k, _fmt_field(k, app["requested"].get(k)), _fmt_field(k, requested.get(k)))
             for k in ("amount", "term", "paymentType", "graceMonths") if app["requested"].get(k) != requested.get(k)]
    if old_f and financials:
        diffs += [(k, _fmt_field(k, old_f[k]), _fmt_field(k, financials[k])) for k in allowed_f if old_f[k] != financials[k]]
    if not diffs:
        return app

    app["version"] += 1
    app["requested"] = requested
    if financials:
        app["financials"] = financials
    text = "; ".join(f"{FIELD_LABEL[f]}: {a} → {b}" for f, a, b in diffs)
    app["changes"] += [{"version": app["version"], "at": iso(at), "field": f, "from": a, "to": b} for f, a, b in diffs]
    with_event(app, at, client, "client_changed", f"Клиент изменил {text}", client_text=f"Вы изменили {text}")

    if app["status"] == "IN_QUEUE":
        return restart_checks(app, at, client, "клиент изменил данные")
    app["changedSinceReview"] = True
    rescore(app, at, SYSTEM, "client_changed")
    return send_message(app, client, f"Изменены данные заявки: {text}. Скоринг пересчитан.", at)


def accept_offer(app: dict, client: dict, at: datetime, offer_id: Optional[str] = None) -> dict:
    decision = app.get("decision") or {}
    if offer_id:
        offer = next((o for o in decision.get("offers", []) if o["id"] == offer_id), None)
        if not offer:
            raise ApiError(404, "Предложение не найдено")
        decision["terms"] = _terms_of(offer)
    move_to(app, "SIGNING", at)
    return with_event(app, at, client, "client_accepted", "Клиент принял условия", client_text="Вы приняли условия")


def decline_offer(app: dict, client: dict, reason: str, at: datetime) -> dict:
    move_to(app, "DECLINED_BY_CLIENT", at)
    reason = (reason or "").strip()
    if reason:
        app["declineReason"] = reason
    return with_event(app, at, client, "client_declined", f"Клиент отказался от предложения{': ' + reason if reason else ''}",
                      client_text="Вы отказались от предложения")


def sign_documents(app: dict, client: dict, at: datetime) -> dict:
    if app["status"] != "SIGNING":
        raise ApiError(409, "Подписание недоступно в этом статусе")
    if app.get("signedAt"):
        return app
    app["signedAt"] = iso(at)
    return with_event(app, at, client, "signed", "Клиент подписал документы (симуляция)", client_text="Документы подписаны (симуляция)")


def mask_account(n: str) -> str:
    return f"•• {n[-4:]}"


def issue(app: dict, client: dict, account_number: str, at: datetime) -> dict:
    if not app.get("signedAt"):
        raise ApiError(409, "Сначала подпишите документы")
    move_to(app, "ISSUED", at)
    app["issued"] = {"accountNumber": account_number, "issuedAt": iso(at)}
    return with_event(app, at, client, "issued", f"Кредит выдан: {engine.rub(final_terms(app)['amount'])} на счёт {mask_account(account_number)}",
                      client_text=f"Кредит выдан: деньги зачислены на счёт {mask_account(account_number)}")


def withdraw(app: dict, client: dict, at: datetime) -> dict:
    move_to(app, "WITHDRAWN", at)
    return with_event(app, at, client, "withdrawn", "Заявка отозвана клиентом", client_text="Вы отозвали заявку")


# ---------------------------------------------------------------------------
# Фоновые проверки и представления
# ---------------------------------------------------------------------------


def tick_all(database: store.Database, at: Optional[datetime] = None, force: bool = False) -> int:
    """Продвинуть авто-проверки всех заявок, у которых подошло время следующего шага. Возвращает число обработанных заявок."""
    at = at or now_utc()
    done = 0
    with database.tx() as c:
        for app in store.list_applications(c):
            if not is_checking(app["status"]):
                continue
            p = app.get("pipeline")
            if p and not force and at < parse_iso(p["nextAt"]):
                continue
            pipeline_tick(c, app, at)
            store.save_application(c, app)
            database.touch()
            done += 1
    return done


def record_view(app: dict) -> dict:
    """Краткая запись заявки: ключевые поля для списков и интеграций."""
    return {
        "applicationId": app["id"], "clientId": app["ownerUserId"], "companyInn": app["company"]["inn"], "status": app["status"],
        "requestedTerms": {"productId": app["productId"], "amount": app["requested"]["amount"], "term": app["requested"]["term"]},
        "scoringResult": app.get("scoringResult"), "decision": app.get("decision"),
        "assignedEmployeeId": app.get("assigneeId"), "updatedAt": app["updatedAt"],
    }


def history_view(app: dict, role: str) -> list[dict]:
    """История глазами роли: клиент видит только открытые события и свои формулировки."""
    if role == "employee":
        return app["history"]
    return [{**e, "text": e.get("clientText") or e["text"]} for e in app["history"] if e["visibleToClient"]]
