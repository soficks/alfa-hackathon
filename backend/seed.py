"""
Демо- и тестовые данные.

seed_demo(): сотрудники банка, тестовый личный кабинет предпринимателя (CLIENT-001, ООО «Пример»), четыре демо-профиля
конвейера и очередь заявок в разных статусах. Заявки создаются теми же операциями, что и боевые (lifecycle.py),
поэтому история, баллы и статусы согласованы с моделью, а не нарисованы.

add_test_applications(): добавить тестовому клиенту набор заявок (черновик, проверка, запрос документов, решение) —
POST /api/clients/{id}/test-applications или `python seed.py --client CLIENT-001`.

Запуск: python seed.py [--reset] [--client CLIENT-001]
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timedelta
from typing import Optional

import db as store
import engine
import lifecycle as lc
import sources as src

MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)
DAY = timedelta(days=1)

CLIENT_ID = "CLIENT-001"
ANNA_ID = "EMP-001"
PAVEL_ID = "EMP-002"

EMPLOYEES = [
    {"id": ANNA_ID, "role": "employee", "firstName": "Анна", "lastName": "Смирнова", "position": "Андеррайтер", "email": "a.smirnova@bank.demo", "phone": ""},
    {"id": PAVEL_ID, "role": "employee", "firstName": "Павел", "lastName": "Орлов", "position": "Андеррайтер", "email": "p.orlov@bank.demo", "phone": ""},
]

DEMO_CLIENT = {
    "id": CLIENT_ID, "role": "client", "firstName": "Юлия", "lastName": "Иванова", "position": "Руководитель", "email": "demo@example.com",
    "phone": "+7 999 000-00-00", "companyInn": src.DEMO_CLIENT_INN, "authority": "Генеральный директор, действует на основании устава", "isTest": True,
}

# Клиенты демо-профилей конвейера (экран входа «Демо-профили»)
PROFILE_CLIENT_IDS = {inn: f"CLIENT-10{i}" for i, inn in enumerate(src.SCENARIOS, start=1)}

ACCOUNTS = [
    {"number": "40702810400000012345", "title": "Расчётный счёт", "companyInn": src.DEMO_CLIENT_INN},
    {"number": "40702810900000067890", "title": "Счёт для расчётов с поставщиками", "companyInn": src.DEMO_CLIENT_INN},
]

DOC_NAMES = {
    "bank_statement": "Выписка по счёту за 12 месяцев.pdf", "financial_statements": "Бухгалтерская отчётность за 2025 год.pdf",
    "supplier_invoice": "Счёт поставщика.pdf", "purchase_contract": "Договор купли-продажи.pdf", "estimate": "Смета на ремонт.xlsx",
    "business_plan": "Бизнес-план.docx", "gov_contract": "Госконтракт.pdf", "debt_certificate": "Справка о задолженности.pdf", "other": "Документ.pdf",
}
SIZES = [248_000, 1_840_000, 412_000, 96_000, 154_000, 2_400_000, 310_000]


def demo_doc(doc_type: str, at: datetime, i: int, name: Optional[str] = None) -> dict:
    return {"id": f"doc-{doc_type}-{int(at.timestamp() * 1000)}-{i}", "name": name or DOC_NAMES[doc_type], "size": SIZES[i % len(SIZES)],
            "docType": doc_type, "addedAt": lc.iso(at), "demo": True}


def client_user(inn: str, company: dict, user_id: str, is_test: bool = False) -> dict:
    last, first = (company["head"].split(" ") + [""])[:2]
    return {
        "id": user_id, "role": "client", "firstName": first, "lastName": last, "email": f"demo-{inn}@example.com", "phone": "+7 999 000-00-00",
        "position": "Индивидуальный предприниматель" if len(inn) == 12 else "Генеральный директор", "companyInn": inn,
        "authority": "Предприниматель, действует от своего имени" if len(inn) == 12 else "Генеральный директор, действует на основании устава",
        **({"isTest": True} if is_test else {}),
    }


def ensure_client(c: sqlite3.Connection, inn: str, now: datetime, owners: dict[str, str]) -> str:
    """Клиент-владелец заявок компании: для демо-профилей — CLIENT-10x, для остальных — следующий CLIENT-xxx."""
    if inn in owners:
        return owners[inn]
    company = lc.registry_lookup(c, inn, now)
    user_id = PROFILE_CLIENT_IDS.get(inn) or f"CLIENT-{len(owners) + 2:03d}"
    store.upsert_user(c, client_user(inn, company, user_id, is_test=inn in PROFILE_CLIENT_IDS))
    if inn in PROFILE_CLIENT_IDS:
        store.upsert_account(c, {"number": f"407028104{inn[-11:].zfill(11)}", "title": "Расчётный счёт", "companyInn": inn})
    owners[inn] = user_id
    return user_id


def create_and_submit(c: sqlite3.Connection, owners: dict[str, str], now: datetime, *, id: str, inn: str, goal: str, amount: int, term: int,
                      docs: list[str], submitted_ago: timedelta, expect: Optional[str] = None, subgoal: Optional[str] = None,
                      payment_type: str = "annuity", grace: Optional[int] = None, owner: Optional[str] = None) -> dict:
    company = lc.registry_lookup(c, inn, now)
    owner_id = owner or ensure_client(c, inn, now, owners)
    product = src.PRODUCTS[src.GOAL_PRODUCT[goal]]
    submitted_at = now - submitted_ago
    created_at = submitted_at - 25 * MINUTE
    client = lc.actor_of(store.get_user(c, owner_id))
    app = lc.blank_application(id, owner_id, company, goal, created_at, engine.DEFAULT_MODEL_VERSION)
    app["requested"] = {"amount": amount, "term": term, "rate": product["baseRate"], "paymentType": payment_type}
    if grace:
        app["requested"]["graceMonths"] = grace
    if subgoal:
        app["subgoalId"] = subgoal
    app["financials"] = src.prefill_financials(inn)
    app["documents"] = [{**demo_doc(t, created_at, i), "addedBy": "client", "source": "submission"} for i, t in enumerate(docs)]
    app["consents"] = {"bki": True, "personalData": True, "authority": True}
    lc.with_event(app, created_at, client, "draft_saved", "Черновик сохранён")
    lc.submit(app, submitted_at, client)
    lc.run_checks_sync(c, app, submitted_at)
    if expect and app["status"] != expect:
        raise RuntimeError(f"Сид {id}: ожидали {expect}, модель дала {app['status']} (балл {(app.get('scoring') or {}).get('score')})")
    return app


def client_of(c: sqlite3.Connection, app: dict) -> dict:
    return lc.actor_of(store.get_user(c, app["ownerUserId"]))


def _settle_employee(app: dict) -> dict:
    for m in app["messages"]:
        m["readByEmployee"] = True
    return app


def seed_demo(database: store.Database, now: Optional[datetime] = None) -> None:
    """Очистить БД и заполнить демо-данными."""
    now = now or lc.now_utc()
    database.clear()
    with database.tx() as c:
        for u in (DEMO_CLIENT, *EMPLOYEES):
            store.upsert_user(c, u)
        for a in ACCOUNTS:
            store.upsert_account(c, a)
        owners: dict[str, str] = {src.DEMO_CLIENT_INN: CLIENT_ID}
        for inn in src.SCENARIOS:
            ensure_client(c, inn, now, owners)
        lc.registry_lookup(c, src.DEMO_CLIENT_INN, now)
        for app in _demo_applications(c, owners, now):
            store.save_application(c, app)
        store.bump_application_seq(c, 1041)
        c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('seeded_at', ?)", (lc.iso(now),))
        database.touch()


def _demo_applications(c: sqlite3.Connection, owners: dict[str, str], now: datetime) -> list[dict]:
    ago = lambda d: now - d  # noqa: E731
    anna = lc.actor_of(EMPLOYEES[0])
    pavel = lc.actor_of(EMPLOYEES[1])
    prev_month = ["декабрь", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь"][now.month - 1]
    DEMO = src.DEMO_CLIENT_INN
    new = lambda **kw: create_and_submit(c, owners, now, **kw)  # noqa: E731
    apps: list[dict] = []

    # --- Клиент: Юлия Иванова, ООО «Пример» ---

    # Черновик, остановились на шаге «Финансы и документы»
    created = ago(2 * DAY + 3 * HOUR)
    draft = lc.blank_application("APP-1001", CLIENT_ID, lc.registry_lookup(c, DEMO, now), "growth", created, engine.DEFAULT_MODEL_VERSION)
    draft["subgoalId"] = "new_point"
    draft["requested"] = {"amount": 1_500_000, "term": 36, "rate": src.PRODUCTS["development"]["baseRate"], "paymentType": "annuity"}
    draft["financials"] = src.prefill_financials(DEMO)
    draft["documents"] = [{**demo_doc("bank_statement", created, 0), "addedBy": "client", "source": "submission"}]
    draft["draftStep"] = 2
    lc.with_event(draft, created, lc.actor_of(DEMO_CLIENT), "draft_saved", "Черновик сохранён")
    apps.append(draft)

    # Нужны документы: специалист запросил выписку за прошлый месяц
    a = new(id="APP-1002", inn=DEMO, goal="working", subgoal="goods", amount=4_000_000, term=24, docs=["bank_statement", "financial_statements"],
            owner=CLIENT_ID, submitted_ago=2 * DAY, expect="IN_QUEUE")
    lc.take_to_work(a, anna, ago(26 * HOUR))
    req_at = ago(25 * HOUR)
    lc.request_documents(a, anna, [{"docType": "bank_statement", "comment": f"Выписка за {prev_month}: в загруженной выписке нет операций за этот месяц."}],
                         lc.add_business_days(req_at, 2), req_at)
    lc.send_message(a, anna, f"Юлия, добрый день! В выписке нет операций за {prev_month}. Загрузите, пожалуйста, выписку за этот месяц — после этого продолжу проверку.",
                    ago(25 * HOUR - 2 * MINUTE))
    apps.append(a)

    # На рассмотрении у Анны: клиент только что закрыл запрос — «Новые документы»
    a = new(id="APP-1003", inn=DEMO, goal="transport", subgoal="truck", amount=3_600_000, term=48, docs=["bank_statement"],
            owner=CLIENT_ID, submitted_ago=30 * HOUR, expect="IN_QUEUE")
    lc.take_to_work(a, anna, ago(27 * HOUR))
    req_at = ago(26 * HOUR)
    lc.request_documents(a, anna, [{"docType": "purchase_contract", "comment": "Нужен договор или счёт на грузовик, который вы покупаете."}],
                         lc.add_business_days(req_at, 2), req_at)
    lc.mark_seen(a, "client")
    lc.add_documents(a, client_of(c, a), [demo_doc("purchase_contract", ago(40 * MINUTE), 3)], ago(40 * MINUTE))
    lc.send_message(a, client_of(c, a), "Добавила договор купли-продажи на грузовик.", ago(38 * MINUTE))
    apps.append(a)

    # Встречное предложение от Анны
    a = new(id="APP-1004", inn=DEMO, goal="equipment", subgoal="new", amount=5_000_000, term=36, payment_type="differentiated",
            docs=["bank_statement", "supplier_invoice"], owner=CLIENT_ID, submitted_ago=3 * DAY, expect="IN_QUEUE")
    lc.take_to_work(a, anna, ago(2 * DAY + 20 * HOUR))
    lc.make_decision(a, anna, {
        "type": "counter_offer", "terms": {"amount": 4_000_000, "term": 36, "rate": 19, "paymentType": "differentiated"}, "validDays": 5,
        "justification": "Оборот позволяет обслуживать 4 млн; по счёту поставщика часть оборудования можно оплатить из собственных средств.",
        "clientMessage": "Можем выдать 4 млн ₽ на тех же условиях — этого хватит на основную часть оборудования по счёту."}, ago(20 * HOUR))
    apps.append(lc.mark_seen(a, "client"))

    # Отказ (прошлый месяц)
    a = new(id="APP-1005", inn=DEMO, goal="refinance", amount=25_000_000, term=60, docs=["bank_statement", "debt_certificate"],
            owner=CLIENT_ID, submitted_ago=36 * DAY, expect="IN_QUEUE")
    lc.take_to_work(a, anna, ago(35 * DAY + 20 * HOUR))
    reason = src.reject_reason("high_debt_load")
    lc.reject_application(a, anna, {
        "reasonCode": reason["code"], "clientMessage": reason["clientMessage"],
        "justification": "Долговая нагрузка с новым кредитом превысит 70% годовой выручки, а сумма к рефинансированию больше текущих долгов по справке."},
        ago(35 * DAY + 2 * HOUR))
    apps.append(lc.mark_seen(a, "client"))

    # Выдан (прошлый месяц): система одобрила сама, клиент подписал и выбрал счёт
    a = new(id="APP-1006", inn=DEMO, goal="working", subgoal="goods", amount=1_500_000, term=12, docs=["bank_statement", "financial_statements"],
            owner=CLIENT_ID, submitted_ago=40 * DAY, expect="APPROVED")
    cl = client_of(c, a)
    lc.accept_offer(a, cl, ago(40 * DAY - 2 * HOUR))
    lc.sign_documents(a, cl, ago(40 * DAY - 2 * HOUR + 10 * MINUTE))
    lc.issue(a, cl, ACCOUNTS[0]["number"], ago(40 * DAY - 2 * HOUR + 12 * MINUTE))
    apps.append(lc.mark_seen(a, "client"))

    # --- Очередь (другие компании) ---

    apps.append(new(id="APP-1011", inn="5027456784", goal="equipment", subgoal="new", amount=6_000_000, term=48, docs=["bank_statement", "supplier_invoice"],
                    submitted_ago=3 * HOUR, expect="IN_QUEUE"))  # высокий балл, но сумма выше авто-лимита
    apps.append(new(id="APP-1012", inn="5008678904", goal="working", subgoal="expenses", amount=3_500_000, term=18, payment_type="differentiated",
                    docs=["bank_statement", "financial_statements"], submitted_ago=4 * DAY, expect="IN_QUEUE"))  # ручная зона, срок проверки просрочен
    apps.append(new(id="APP-1013", inn="502478901250", goal="growth", subgoal="new_line", amount=3_000_000, term=36, docs=["bank_statement"],
                    submitted_ago=5 * HOUR, expect="IN_QUEUE"))  # высокий риск
    apps.append(new(id="APP-1014", inn="770367890190", goal="working", subgoal="goods", amount=600_000, term=12, docs=["bank_statement", "financial_statements"],
                    submitted_ago=90 * MINUTE, expect="IN_QUEUE"))  # молодой бизнес
    a = new(id="APP-1015", inn="7726789010", goal="working", subgoal="payroll", amount=3_200_000, term=24, docs=["bank_statement", "financial_statements"],
            submitted_ago=7 * HOUR, expect="IN_QUEUE")
    lc.take_to_work(a, pavel, ago(6 * HOUR))  # у другого сотрудника — только просмотр
    apps.append(a)

    # --- «Мои проверки» Анны ---

    a = new(id="APP-1021", inn="7701111110", goal="working", subgoal="payroll", amount=10_000_000, term=12, docs=["bank_statement", "financial_statements"],
            submitted_ago=20 * HOUR, expect="IN_QUEUE")  # АльфаТех: обороты за 3 месяца падают
    lc.take_to_work(a, anna, ago(2 * HOUR))
    apps.append(a)
    a = new(id="APP-1022", inn="500312345614", goal="equipment", subgoal="upgrade", amount=3_500_000, term=36, docs=["bank_statement", "supplier_invoice"],
            submitted_ago=9 * HOUR, expect="IN_QUEUE")  # готова к решению: все проверки пройдены
    lc.take_to_work(a, anna, ago(8 * HOUR))
    apps.append(a)
    a = new(id="APP-1024", inn="7810345670", goal="transport", subgoal="truck", amount=3_400_000, term=48, docs=["bank_statement"],
            submitted_ago=6 * DAY, expect="IN_QUEUE")  # ждём клиента, срок ответа прошёл
    lc.take_to_work(a, anna, ago(6 * DAY - 3 * HOUR))
    req_at = ago(6 * DAY - 4 * HOUR)
    lc.request_documents(a, anna, [{"docType": "purchase_contract", "comment": "Пришлите договор купли-продажи или счёт на транспорт."}],
                         lc.add_business_days(req_at, 2), req_at)
    apps.append(a)

    # --- «История» Анны ---

    a = new(id="APP-1031", inn="7715234560", goal="equipment", subgoal="new", amount=4_500_000, term=36, docs=["bank_statement"],
            submitted_ago=9 * DAY, expect="IN_QUEUE")  # одобрено → выдан
    lc.take_to_work(a, anna, ago(8 * DAY + 20 * HOUR))
    req_at = ago(8 * DAY + 19 * HOUR)
    lc.request_documents(a, anna, [{"docType": "supplier_invoice", "comment": "Нужен счёт или спецификация на станок."}],
                         lc.add_business_days(req_at, 2), req_at)
    lc.add_documents(a, client_of(c, a), [demo_doc("supplier_invoice", ago(8 * DAY + 2 * HOUR), 3)], ago(8 * DAY + 2 * HOUR))
    lc.make_decision(a, anna, {
        "type": "approve", "terms": {"amount": 4_500_000, "term": 36, "rate": 18, "paymentType": "annuity"}, "validDays": 5,
        "justification": "Поступления по счёту подтверждают оборот, просрочек нет, счёт поставщика соответствует сумме.", "clientMessage": ""}, ago(8 * DAY))
    cl = client_of(c, a)
    lc.accept_offer(a, cl, ago(7 * DAY + 5 * HOUR))
    lc.sign_documents(a, cl, ago(7 * DAY + 4 * HOUR))
    lc.issue(a, cl, "40702810100000054321", ago(7 * DAY + 4 * HOUR - 5 * MINUTE))
    apps.append(a)

    a = new(id="APP-1032", inn="5027456784", goal="transport", subgoal="special", amount=4_000_000, term=36, docs=["bank_statement", "purchase_contract"],
            submitted_ago=4 * DAY, expect="IN_QUEUE")  # одобрено → ждём подписания
    lc.take_to_work(a, anna, ago(3 * DAY + 22 * HOUR))
    lc.make_decision(a, anna, {
        "type": "approve", "terms": {"amount": 4_000_000, "term": 36, "rate": 18, "paymentType": "annuity"}, "validDays": 5,
        "justification": "Высокий балл, стабильные обороты, договор на спецтехнику проверен. Сумма выше авто-лимита — подтверждаю вручную.",
        "clientMessage": ""}, ago(3 * DAY + 20 * HOUR))
    lc.accept_offer(a, client_of(c, a), ago(3 * DAY))
    apps.append(a)

    a = new(id="APP-1033", inn="7730890126", goal="equipment", subgoal="upgrade", amount=6_000_000, term=36, docs=["bank_statement", "supplier_invoice"],
            submitted_ago=30 * DAY, expect="IN_QUEUE")  # встречное → клиент отказался
    lc.take_to_work(a, anna, ago(29 * DAY + 20 * HOUR))
    lc.make_decision(a, anna, {
        "type": "counter_offer", "terms": {"amount": 4_000_000, "term": 48, "rate": 19, "paymentType": "annuity"}, "validDays": 5,
        "justification": "Платёж по 6 млн на 36 мес. превышает 35% оборота; на 4 млн и 48 мес. нагрузка допустимая.",
        "clientMessage": "Можем выдать 4 млн ₽ на 48 месяцев — так платёж будет комфортнее для ваших оборотов."}, ago(29 * DAY))
    lc.decline_offer(a, client_of(c, a), "Нужна вся сумма сразу", ago(27 * DAY))
    apps.append(a)

    a = new(id="APP-1034", inn="7716901231", goal="working", subgoal="goods", amount=3_300_000, term=24, docs=["bank_statement", "financial_statements"],
            submitted_ago=6 * DAY, expect="IN_QUEUE")  # клиент отозвал заявку во время проверки
    lc.take_to_work(a, anna, ago(5 * DAY + 20 * HOUR))
    lc.send_message(a, client_of(c, a), "Получили оплату от покупателя, кредит больше не нужен. Отзываю заявку.", ago(5 * DAY + 4 * HOUR))
    lc.withdraw(a, client_of(c, a), ago(5 * DAY + 4 * HOUR - MINUTE))
    apps.append(lc.mark_seen(a, "employee"))

    # --- Демо-профили конвейера: у каждого свой автоматический сценарий ---
    profile_goal = {src.ALFA: (2_000_000, 24), src.SMIRNOV: (2_000_000, 24), src.TECHNO: (3_000_000, 24), src.VECTOR: (500_000, 12)}
    for n, (inn, (amount, term)) in enumerate(profile_goal.items(), start=1):
        apps.append(new(id=f"APP-{1035 + n}", inn=inn, goal="working", subgoal="goods", amount=amount, term=term,
                        docs=["bank_statement", "financial_statements"], submitted_ago=(10 + n) * MINUTE, expect=src.SCENARIOS[inn]))

    # Сотрудник уже прочитал всё, кроме свежего сообщения в APP-1003
    return [a if a["id"] == "APP-1003" else _settle_employee(a) for a in apps]


# ---------------------------------------------------------------------------
# Тестовые заявки для конкретного клиента
# ---------------------------------------------------------------------------

TEST_SCENARIOS = ["draft", "queued", "need_docs", "approved_manual"]


def add_test_applications(database: store.Database, client_id: str, scenarios: Optional[list[str]] = None, now: Optional[datetime] = None) -> list[dict]:
    """Добавить клиенту тестовые заявки по его компании. Возвращает [{applicationId, status}]."""
    now = now or lc.now_utc()
    scenarios = scenarios or TEST_SCENARIOS
    unknown = [s for s in scenarios if s not in TEST_SCENARIOS]
    if unknown:
        raise src.ApiError(422, f"Неизвестные сценарии: {', '.join(unknown)}. Доступны: {', '.join(TEST_SCENARIOS)}")
    created: list[dict] = []
    with database.tx() as c:
        user = store.get_user(c, client_id)
        if not user or user["role"] != "client" or not user.get("companyInn"):
            raise src.ApiError(404, "Клиент не найден или к нему не привязана компания")
        inn = user["companyInn"]
        anna = lc.actor_of(EMPLOYEES[0])
        for k, scenario in enumerate(scenarios):
            app_id = store.next_application_id(c)
            at = now - (k + 1) * HOUR
            if scenario == "draft":
                company = lc.registry_lookup(c, inn, now)
                app = lc.blank_application(app_id, client_id, company, "working", at, engine.DEFAULT_MODEL_VERSION)
                app["requested"] = {"amount": 1_000_000, "term": 12, "rate": 21, "paymentType": "annuity"}
                app["financials"] = src.prefill_financials(inn)
                app["draftStep"] = 1
                lc.with_event(app, at, lc.actor_of(user), "draft_saved", "Черновик сохранён")
            else:
                amount = 800_000 if scenario != "approved_manual" else 3_500_000
                app = _submitted_test_app(c, user, app_id, amount, at)
                if app["status"] == "IN_QUEUE" and scenario in ("need_docs", "approved_manual"):
                    lc.take_to_work(app, anna, at + 10 * MINUTE)
                    if scenario == "need_docs":
                        lc.request_documents(app, anna, [{"docType": "financial_statements", "comment": "Загрузите бухгалтерскую отчётность за прошлый год."}],
                                             lc.add_business_days(at, 2), at + 12 * MINUTE)
                    else:
                        t = {"amount": amount, "term": 24, "rate": src.PRODUCTS["working_capital"]["baseRate"], "paymentType": "annuity"}
                        lc.make_decision(app, anna, {"type": "approve", "terms": t, "validDays": 5, "clientMessage": "",
                                                     "justification": "Тестовая заявка: обороты подтверждены, просрочек нет, одобряем вручную."}, at + 15 * MINUTE)
            store.save_application(c, app)
            created.append({"applicationId": app_id, "status": app["status"], "scenario": scenario})
        database.touch()
    return created


def _submitted_test_app(c: sqlite3.Connection, user: dict, app_id: str, amount: int, at: datetime) -> dict:
    inn = user["companyInn"]
    company = lc.registry_lookup(c, inn, at)
    app = lc.blank_application(app_id, user["id"], company, "working", at, engine.DEFAULT_MODEL_VERSION)
    app["requested"] = {"amount": amount, "term": 24, "rate": 21, "paymentType": "annuity"}
    app["subgoalId"] = "goods"
    app["financials"] = src.prefill_financials(inn)
    app["documents"] = [{**demo_doc("bank_statement", at, 0), "addedBy": "client", "source": "submission"}]
    app["consents"] = {"bki": True, "personalData": True, "authority": True}
    actor = lc.actor_of(user)
    lc.with_event(app, at, actor, "draft_saved", "Черновик сохранён")
    lc.submit(app, at + 5 * MINUTE, actor)
    return lc.run_checks_sync(c, app, at + 5 * MINUTE)


def main() -> None:
    parser = argparse.ArgumentParser(description="Демо- и тестовые данные кабинета")
    parser.add_argument("--reset", action="store_true", help="очистить БД и заполнить демо-данными")
    parser.add_argument("--client", help="добавить тестовые заявки клиенту (например CLIENT-001)")
    args = parser.parse_args()
    database = store.Database()
    if args.reset or database.is_empty():
        seed_demo(database)
        print(f"Демо-данные загружены: {database.path}")
    if args.client:
        for item in add_test_applications(database, args.client):
            print(f"{item['applicationId']}: {item['scenario']} -> {item['status']}")


if __name__ == "__main__":
    main()
