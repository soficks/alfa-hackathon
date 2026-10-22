"""
Цифровой кредитный конвейер для МСБ — MVP бэкенда (FastAPI, один файл).

Пайплайн заявки:
    1. Gatekeeper     — хард-фильтры по ФНС/ЕГРЮЛ и БКИ (ликвидация -> REJECTED).
    2. Quality Check  — сверка запрошенной суммы с оборотами в DWH банка (мало -> NEED_INFO).
    3. Brain          — расчёт аннуитетного платежа и PTI.
    4. Solver         — APPROVED / COUNTER_OFFER / REJECTED.

PTI = (текущие платежи по кредитам + платёж по новой заявке) / (подтверждённый оборот * 0.25)

Все суммы — в рублях, обороты и платежи — помесячные, ставки — % годовых.
Продукты и коды причин отказа совпадают с фронтом (front/src/config/products.ts, rejectReasons.ts).
Внешних API нет: ФНС, БКИ и DWH — in-memory моки ниже.

Запуск:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
    Swagger: http://localhost:8000/docs
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ---------------------------------------------------------------------------
# Параметры кредитной политики
# ---------------------------------------------------------------------------

TURNOVER_TO_CASHFLOW = 0.25   # доля оборота, которую можно направить на обслуживание долга
PTI_APPROVE = 0.5             # PTI < 0.5  -> автоодобрение
PTI_DECLINE = 0.8             # PTI >= 0.8 -> отказ; между ними — контр-оффер
MAX_AMOUNT_TO_TURNOVER = 2.0  # сумма заявки не больше 2 месячных оборотов, иначе нужна выписка
AMOUNT_STEP = 50_000          # шаг суммы, как на фронте
TERM_GRID = (6, 12, 18, 24, 36, 48, 60, 84, 120)  # сроки, которые перебирает Solver

# id, ставки и лимиты — как во front/src/config/products.ts
PRODUCTS: dict[str, dict] = {
    "working_capital": {"name": "Оборотный кредит", "rate": 21, "min_amount": 300_000, "max_amount": 30_000_000, "min_term": 3, "max_term": 24},
    "credit_line": {"name": "Кредитная линия", "rate": 22, "min_amount": 300_000, "max_amount": 30_000_000, "min_term": 1, "max_term": 18},
    "investment": {"name": "Инвестиционный кредит", "rate": 19, "min_amount": 500_000, "max_amount": 50_000_000, "min_term": 12, "max_term": 60},
    "transport": {"name": "Кредит на транспорт", "rate": 19, "min_amount": 300_000, "max_amount": 50_000_000, "min_term": 12, "max_term": 60},
    "real_estate": {"name": "Кредит под залог недвижимости", "rate": 18, "min_amount": 1_000_000, "max_amount": 150_000_000, "min_term": 12, "max_term": 120},
    "development": {"name": "Кредит на развитие", "rate": 21, "min_amount": 500_000, "max_amount": 30_000_000, "min_term": 12, "max_term": 60},
    "gov_contract": {"name": "Кредит под контракт", "rate": 20, "min_amount": 300_000, "max_amount": 30_000_000, "min_term": 1, "max_term": 24},
    "refinance": {"name": "Рефинансирование", "rate": 19, "min_amount": 500_000, "max_amount": 150_000_000, "min_term": 12, "max_term": 120},
}
DEFAULT_PRODUCT = "working_capital"

# ---------------------------------------------------------------------------
# Мок-данные: ФНС/ЕГРЮЛ, БКИ, DWH банка — 4 эталонных профиля для демо.
# ИНН и ОГРН проходят контрольные суммы (фронт их проверяет). Фронт забирает
# профили через GET /api/profiles, поэтому данные живут только здесь.
# ---------------------------------------------------------------------------

ALFA, SMIRNOV, TECHNO, VECTOR = "7701111128", "770222222209", "7703333334", "7705555558"

FNS_EGRUL: dict[str, dict] = {
    ALFA: {
        "name": "ООО «Альфа Логистик»", "ogrn": "1217700111111", "status": "ACTIVE",
        "okved": "49.41", "okved_name": "Деятельность автомобильного грузового транспорта",
        "address": "г. Москва, Складская ул., д. 7", "age_months": 64, "head": "Кузнецов Игорь Олегович",
    },
    SMIRNOV: {
        "name": "ИП Смирнов Андрей Викторович", "ogrn": "320770002222227", "status": "ACTIVE",
        "okved": "56.10", "okved_name": "Деятельность ресторанов и услуги по доставке продуктов питания",
        "address": "г. Москва, ул. Покровка, д. 12", "age_months": 40, "head": "Смирнов Андрей Викторович",
    },
    TECHNO: {
        "name": "ООО «ТехноСтрой»", "ogrn": "1227700333332", "status": "ACTIVE",
        "okved": "41.20", "okved_name": "Строительство жилых и нежилых зданий",
        "address": "г. Москва, Строительный пр-д, д. 3", "age_months": 30, "head": "Белова Марина Игоревна",
    },
    VECTOR: {
        "name": "ООО «Вектор Плюс»", "ogrn": "1197700555557", "status": "LIQUIDATING",
        "okved": "47.11", "okved_name": "Торговля розничная в неспециализированных магазинах",
        "address": "г. Москва, Торговая ул., д. 21", "age_months": 75, "head": "Петров Олег Сергеевич",
    },
}

# monthly_payments — текущие ежемесячные платежи по действующим кредитам (они идут в PTI)
BKI: dict[str, dict] = {
    ALFA: {"loans": 2, "total_debt": 3_300_000, "monthly_payments": 150_000, "overdue_current": False, "overdue_closed_12m": 0},
    SMIRNOV: {"loans": 2, "total_debt": 3_900_000, "monthly_payments": 180_000, "overdue_current": False, "overdue_closed_12m": 0},
    TECHNO: {"loans": 1, "total_debt": 1_100_000, "monthly_payments": 50_000, "overdue_current": False, "overdue_closed_12m": 0},
    VECTOR: {"loans": 1, "total_debt": 2_600_000, "monthly_payments": 120_000, "overdue_current": False, "overdue_closed_12m": 1},
}

# Среднемесячный оборот по счетам в нашем банке
DWH: dict[str, int] = {
    ALFA: 6_000_000,
    SMIRNOV: 1_800_000,
    TECHNO: 800_000,
    VECTOR: 300_000,
}

# Что «распознаётся» в выписке из другого банка: дополнительный оборот в месяц
EXTERNAL_STATEMENTS: dict[str, int] = {
    TECHNO: 1_200_000,
}

SCENARIOS = {
    ALFA: "APPROVED",
    SMIRNOV: "COUNTER_OFFER",
    TECHNO: "NEED_INFO",
    VECTOR: "REJECTED",
}

# ---------------------------------------------------------------------------
# Модели
# ---------------------------------------------------------------------------


class Schema(BaseModel):
    """JSON в camelCase, как в TypeScript-типах фронта."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Status(str, Enum):
    APPROVED = "APPROVED"
    COUNTER_OFFER = "COUNTER_OFFER"
    NEED_INFO = "NEED_INFO"
    REJECTED = "REJECTED"


class ReasonCode(str, Enum):
    """Коды совпадают с front/src/config/rejectReasons.ts (кроме запроса документов)."""

    COMPANY_LIQUIDATED = "company_liquidated"
    OVERDUE_CURRENT = "overdue_current"
    HIGH_DEBT_LOAD = "high_debt_load"
    LOW_TURNOVER = "low_turnover"
    UNRELIABLE_DATA = "unreliable_data"
    NEED_BANK_STATEMENT = "need_bank_statement"


REASON_TEXT: dict[ReasonCode, str] = {
    ReasonCode.COMPANY_LIQUIDATED: "По данным ЕГРЮЛ компания находится в стадии ликвидации, поэтому кредит на неё оформить нельзя.",
    ReasonCode.OVERDUE_CURRENT: "По данным кредитной истории сейчас есть непогашенная просрочка.",
    ReasonCode.HIGH_DEBT_LOAD: "Долговая нагрузка (PTI) с новым кредитом превышает допустимый уровень.",
    ReasonCode.LOW_TURNOVER: "Текущие платежи по кредитам уже исчерпывают допустимую долговую нагрузку.",
    ReasonCode.UNRELIABLE_DATA: "Компания не найдена в ЕГРЮЛ/ЕГРИП.",
    ReasonCode.NEED_BANK_STATEMENT: (
        "Запрошенная сумма превышает обороты по счёту в банке. "
        "Загрузите выписку из другого банка, чтобы подтвердить выручку."
    ),
}


class ApplicationIn(Schema):
    inn: str = Field(..., pattern=r"^\d{10}(\d{2})?$", examples=[ALFA])
    amount: int = Field(..., gt=0, examples=[2_000_000])
    term: int = Field(..., gt=0, description="Срок, мес.", examples=[24])
    product: str = Field(DEFAULT_PRODUCT, description="id продукта или его название", examples=["working_capital"])
    external_statement: bool = Field(False, description="Клиент уже загрузил выписку из другого банка")


class DocumentIn(Schema):
    doc_type: str = Field("bank_statement", examples=["bank_statement"])
    file_name: str = Field("Выписка.pdf", examples=["Выписка за сентябрь 2026.pdf"])


class AcceptOfferIn(Schema):
    offer_id: str


class Check(Schema):
    stage: str
    name: str
    passed: bool
    details: str


class Offer(Schema):
    id: str
    title: str
    amount: int
    term: int
    rate: float
    monthly_payment: int
    pti: float


class Scoring(Schema):
    confirmed_turnover: int
    debt_service_capacity: int
    current_monthly_payments: int
    new_monthly_payment: int
    pti: float


class Decision(Schema):
    status: Status
    reason_code: Optional[ReasonCode] = None
    scoring: Optional[Scoring] = None
    offers: list[Offer] = []
    checks: list[Check] = []


class Application(Schema):
    id: str
    created_at: datetime
    updated_at: datetime
    inn: str
    company_name: Optional[str]
    product_id: str
    product_name: str
    rate: float
    amount: int
    term: int
    status: Status
    reason_code: Optional[ReasonCode] = None
    reason_text: Optional[str] = None
    scoring: Optional[Scoring] = None
    offers: list[Offer] = []
    checks: list[Check] = []
    documents: list[DocumentIn] = []


# ---------------------------------------------------------------------------
# Математика
# ---------------------------------------------------------------------------


def annuity_payment(amount: float, term: int, rate: float) -> float:
    r = rate / 12 / 100
    if r == 0:
        return amount / term
    return amount * r / (1 - (1 + r) ** -term)


def max_amount_for_payment(payment: float, term: int, rate: float) -> float:
    r = rate / 12 / 100
    if r == 0:
        return payment * term
    return payment * (1 - (1 + r) ** -term) / r


def calc_pti(current_payments: float, new_payment: float, turnover: float) -> float:
    capacity = turnover * TURNOVER_TO_CASHFLOW
    if capacity <= 0:
        return math.inf
    return (current_payments + new_payment) / capacity


def resolve_product(product: str) -> tuple[str, dict]:
    if product in PRODUCTS:
        return product, PRODUCTS[product]
    for pid, p in PRODUCTS.items():
        if p["name"].lower() == product.strip().lower():
            return pid, p
    raise HTTPException(422, f"Неизвестный продукт: {product}")


# ---------------------------------------------------------------------------
# Пайплайн
# ---------------------------------------------------------------------------


def rub(n: float) -> str:
    return f"{round(n):,}".replace(",", " ") + " ₽"


def gatekeeper(inn: str, checks: list[Check]) -> Optional[ReasonCode]:
    company = FNS_EGRUL.get(inn)
    if company is None:
        checks.append(Check(stage="gatekeeper", name="ЕГРЮЛ", passed=False, details="ИНН не найден"))
        return ReasonCode.UNRELIABLE_DATA
    if company["status"] == "LIQUIDATING":
        checks.append(Check(stage="gatekeeper", name="ЕГРЮЛ", passed=False, details="Статус: LIQUIDATING"))
        return ReasonCode.COMPANY_LIQUIDATED
    checks.append(Check(stage="gatekeeper", name="ЕГРЮЛ", passed=True, details=f"Статус: {company['status']}"))

    if BKI[inn]["overdue_current"]:
        checks.append(Check(stage="gatekeeper", name="БКИ", passed=False, details="Текущая просрочка"))
        return ReasonCode.OVERDUE_CURRENT
    checks.append(Check(stage="gatekeeper", name="БКИ", passed=True, details="Просрочек нет"))
    return None


def confirmed_turnover(inn: str, statement_uploaded: bool) -> int:
    turnover = DWH.get(inn, 0)
    if statement_uploaded:
        turnover += EXTERNAL_STATEMENTS.get(inn, 0)
    return turnover


def quality_check(amount: int, turnover: int, statement_uploaded: bool, checks: list[Check]) -> Optional[ReasonCode]:
    source = "DWH банка + выписка" if statement_uploaded else "DWH банка"
    limit = turnover * MAX_AMOUNT_TO_TURNOVER
    if amount > limit:
        checks.append(Check(
            stage="quality_check", name="Сверка оборотов", passed=False,
            details=f"Сумма {rub(amount)} > {MAX_AMOUNT_TO_TURNOVER:g} × оборот {rub(turnover)}/мес ({source})",
        ))
        return ReasonCode.NEED_BANK_STATEMENT
    checks.append(Check(
        stage="quality_check", name="Сверка оборотов", passed=True,
        details=f"Оборот {rub(turnover)}/мес ({source})",
    ))
    return None


def make_offer(offer_id: str, title: str, amount: int, term: int, rate: float, current: int, turnover: int) -> Offer:
    payment = annuity_payment(amount, term, rate)
    return Offer(
        id=offer_id, title=title, amount=amount, term=term, rate=rate,
        monthly_payment=round(payment), pti=round(calc_pti(current, payment, turnover), 4),
    )


def fit_amount(max_payment: float, term: int, rate: float, current: int, turnover: int) -> int:
    """Максимальная сумма (кратная AMOUNT_STEP), при которой PTI строго < PTI_APPROVE."""
    amount = int(max_amount_for_payment(max_payment, term, rate) // AMOUNT_STEP * AMOUNT_STEP)
    while amount > 0 and calc_pti(current, annuity_payment(amount, term, rate), turnover) >= PTI_APPROVE:
        amount -= AMOUNT_STEP
    return amount


def solver(amount: int, term: int, product: dict, current: int, turnover: int) -> list[Offer]:
    """Подбирает условия в рамках продукта, при которых PTI < PTI_APPROVE. Пустой список — вариантов нет."""
    rate, max_term = product["rate"], product["max_term"]
    max_payment = PTI_APPROVE * turnover * TURNOVER_TO_CASHFLOW - current
    if max_payment <= 0:
        return []

    offers: list[Offer] = []

    # Вариант 1: та же сумма, срок больше
    for t in TERM_GRID:
        if term < t <= max_term and calc_pti(current, annuity_payment(amount, t, rate), turnover) < PTI_APPROVE:
            offers.append(make_offer("extend_term", "Увеличение срока", amount, t, rate, current, turnover))
            break

    # Вариант 2: тот же срок, сумма меньше
    reduced = fit_amount(max_payment, term, rate, current, turnover)
    if reduced >= product["min_amount"]:
        offers.append(make_offer("reduce_amount", "Снижение суммы", reduced, term, rate, current, turnover))

    # Вариант 3: одного срока не хватило — максимальный срок продукта и максимально возможная сумма
    if not any(o.id == "extend_term" for o in offers) and term < max_term:
        combo = fit_amount(max_payment, max_term, rate, current, turnover)
        if combo > reduced and combo >= product["min_amount"]:
            offers.append(make_offer("max_term", "Увеличение срока и снижение суммы", min(combo, amount), max_term, rate, current, turnover))

    return offers


def run_pipeline(inn: str, amount: int, term: int, product: dict, statement_uploaded: bool) -> Decision:
    checks: list[Check] = []

    # 1. Gatekeeper
    reason = gatekeeper(inn, checks)
    if reason:
        return Decision(status=Status.REJECTED, reason_code=reason, checks=checks)

    # 2. Quality Check
    turnover = confirmed_turnover(inn, statement_uploaded)
    reason = quality_check(amount, turnover, statement_uploaded, checks)
    if reason:
        return Decision(status=Status.NEED_INFO, reason_code=reason, checks=checks)

    # 3. Brain
    current = BKI[inn]["monthly_payments"]
    payment = annuity_payment(amount, term, product["rate"])
    pti = calc_pti(current, payment, turnover)
    scoring = Scoring(
        confirmed_turnover=turnover,
        debt_service_capacity=round(turnover * TURNOVER_TO_CASHFLOW),
        current_monthly_payments=current,
        new_monthly_payment=round(payment),
        pti=round(pti, 4),
    )
    checks.append(Check(stage="brain", name="PTI", passed=pti < PTI_APPROVE, details=f"PTI = {pti:.3f}"))

    # 4. Solver
    if pti < PTI_APPROVE:
        return Decision(status=Status.APPROVED, scoring=scoring, checks=checks)
    if pti >= PTI_DECLINE:
        return Decision(status=Status.REJECTED, reason_code=ReasonCode.HIGH_DEBT_LOAD, scoring=scoring, checks=checks)

    offers = solver(amount, term, product, current, turnover)
    if not offers:
        checks.append(Check(stage="solver", name="Контр-оффер", passed=False, details="Нет условий с PTI < 0.5"))
        return Decision(status=Status.REJECTED, reason_code=ReasonCode.LOW_TURNOVER, scoring=scoring, checks=checks)
    checks.append(Check(stage="solver", name="Контр-оффер", passed=True, details=f"Вариантов: {len(offers)}"))
    return Decision(status=Status.COUNTER_OFFER, scoring=scoring, offers=offers, checks=checks)


# ---------------------------------------------------------------------------
# In-memory хранилище заявок
# ---------------------------------------------------------------------------

APPLICATIONS: dict[str, Application] = {}


def now() -> datetime:
    return datetime.now(timezone.utc)


def has_statement(app_: Application) -> bool:
    return any(d.doc_type == "bank_statement" for d in app_.documents)


def rescore(app_: Application) -> Application:
    decision = run_pipeline(app_.inn, app_.amount, app_.term, PRODUCTS[app_.product_id], has_statement(app_))
    app_.status = decision.status
    app_.reason_code = decision.reason_code
    app_.reason_text = REASON_TEXT.get(decision.reason_code) if decision.reason_code else None
    app_.scoring = decision.scoring
    app_.offers = decision.offers
    app_.checks = decision.checks
    app_.updated_at = now()
    return app_


def get_application(app_id: str) -> Application:
    app_ = APPLICATIONS.get(app_id)
    if app_ is None:
        raise HTTPException(404, "Заявка не найдена")
    return app_


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

app = FastAPI(title="Кредитный конвейер МСБ", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/products")
def list_products():
    return [{"id": pid, **p} for pid, p in PRODUCTS.items()]


def profile(inn: str) -> dict:
    """Профиль в форме типов фронта: registry (Company без даты), bki (BkiReport), statement."""
    egrul, bki = FNS_EGRUL[inn], BKI[inn]
    return {
        "inn": inn,
        "scenario": SCENARIOS.get(inn),
        "registry": {
            "inn": inn,
            "ogrn": egrul["ogrn"],
            "name": egrul["name"],
            "address": egrul["address"],
            "ageMonths": egrul["age_months"],
            "okved": egrul["okved"],
            "okvedName": egrul["okved_name"],
            "status": "liquidated" if egrul["status"] == "LIQUIDATING" else "active",
            "head": egrul["head"],
        },
        "bki": {
            "inn": inn,
            "loans": bki["loans"],
            "totalDebt": bki["total_debt"],
            "monthlyPayments": bki["monthly_payments"],
            "overdueCurrent": bki["overdue_current"],
            "overdueClosed12m": bki["overdue_closed_12m"],
        },
        "statement": {"monthlyTurnover": DWH[inn]},
    }


@app.get("/api/profiles")
def list_profiles():
    return [profile(inn) for inn in FNS_EGRUL]


@app.get("/api/profiles/{inn}")
def get_profile(inn: str):
    if inn not in FNS_EGRUL:
        raise HTTPException(404, "Компания не найдена")
    return profile(inn)


@app.post("/api/applications", response_model=Application, status_code=201, response_model_by_alias=True)
def create_application(body: ApplicationIn):
    product_id, product = resolve_product(body.product)
    if not product["min_amount"] <= body.amount <= product["max_amount"]:
        raise HTTPException(422, f"Сумма для «{product['name']}»: от {rub(product['min_amount'])} до {rub(product['max_amount'])}")
    if not product["min_term"] <= body.term <= product["max_term"]:
        raise HTTPException(422, f"Срок для «{product['name']}»: от {product['min_term']} до {product['max_term']} мес.")

    company = FNS_EGRUL.get(body.inn)
    app_ = Application(
        id=str(uuid.uuid4()),
        created_at=now(),
        updated_at=now(),
        inn=body.inn,
        company_name=company["name"] if company else None,
        product_id=product_id,
        product_name=product["name"],
        rate=product["rate"],
        amount=body.amount,
        term=body.term,
        status=Status.NEED_INFO,
        documents=[DocumentIn(file_name="Выписка из другого банка.pdf")] if body.external_statement else [],
    )
    APPLICATIONS[app_.id] = rescore(app_)
    return app_


@app.get("/api/applications", response_model=list[Application])
def list_applications(inn: Optional[str] = None):
    items = [a for a in APPLICATIONS.values() if inn is None or a.inn == inn]
    return sorted(items, key=lambda a: a.created_at, reverse=True)


@app.get("/api/applications/{app_id}", response_model=Application)
def read_application(app_id: str):
    return get_application(app_id)


@app.post("/api/applications/{app_id}/documents", response_model=Application)
def upload_document(app_id: str, body: DocumentIn):
    """Дозагрузка документа (симуляция OCR выписки) и повторный прогон конвейера."""
    app_ = get_application(app_id)
    if app_.status != Status.NEED_INFO:
        raise HTTPException(409, "Документы запрашиваются только в статусе NEED_INFO")
    app_.documents.append(body)
    return rescore(app_)


@app.post("/api/applications/{app_id}/accept-offer", response_model=Application)
def accept_offer(app_id: str, body: AcceptOfferIn):
    """Клиент принимает контр-оффер: условия заменяются, заявка проходит конвейер заново."""
    app_ = get_application(app_id)
    if app_.status != Status.COUNTER_OFFER:
        raise HTTPException(409, "Заявка не в статусе COUNTER_OFFER")
    offer = next((o for o in app_.offers if o.id == body.offer_id), None)
    if offer is None:
        raise HTTPException(404, "Предложение не найдено")
    app_.amount, app_.term = offer.amount, offer.term
    return rescore(app_)


@app.post("/api/reset", status_code=204)
def reset():
    APPLICATIONS.clear()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
