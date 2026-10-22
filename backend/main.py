"""
Цифровой кредитный конвейер для МСБ — MVP бэкенда (FastAPI, один файл).

Пайплайн заявки:
    1. Gatekeeper     — стоп-факторы по ФНС/ЕГРЮЛ и БКИ (ликвидация, просрочка, молодой бизнес -> REJECTED).
    2. Quality Check  — сверка запрошенной суммы с оборотами в DWH банка (мало -> NEED_INFO).
    3. Brain          — график платежей, балльная модель 0–1000 и PTI.
    4. Solver         — APPROVED / COUNTER_OFFER / REJECTED.

PTI = (текущие платежи по кредитам + платёж по новой заявке) / (подтверждённый оборот * 0.25)

Балл влияет на решение: зона высокого риска (< 400) — отказ, балл >= 800 — ставка на 1 п.п. ниже.
Платёж по новой заявке считается по выбранному типу графика (см. load_payment).

Все суммы — в рублях, обороты и платежи — помесячные, ставки — % годовых.
Продукты, балльная модель и коды причин отказа совпадают с фронтом
(front/src/config/products.ts, front/src/mocks/scoring.ts, front/src/config/rejectReasons.ts).
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
from typing import Literal, Optional

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
STOP_BUSINESS_AGE_MONTHS = 6  # меньше — стоп-фактор

BASE_SCORE = 500
HIGH_RISK_SCORE = 400         # ниже — зона высокого риска, отказ
GOOD_SCORE = 800              # от него — скидка 1 п.п. к ставке
AUTO_SCORE = 700              # граница зон manual / auto (для отображения)

PaymentType = Literal["annuity", "differentiated", "interest_only", "annuity_grace"]

PAYMENT_TYPE_LABEL = {
    "annuity": "аннуитетный",
    "differentiated": "дифференцированный",
    "interest_only": "проценты ежемесячно, долг в конце",
    "annuity_grace": "с отсрочкой",
}

# id, ставки, лимиты и типы платежа — как во front/src/config/products.ts
PRODUCTS: dict[str, dict] = {
    "working_capital": {"name": "Оборотный кредит", "rate": 21, "min_amount": 300_000, "max_amount": 30_000_000,
                        "min_term": 3, "max_term": 24, "payment_types": ["annuity", "differentiated"]},
    "credit_line": {"name": "Кредитная линия", "rate": 22, "min_amount": 300_000, "max_amount": 30_000_000,
                    "min_term": 1, "max_term": 18, "payment_types": ["interest_only"]},
    "investment": {"name": "Инвестиционный кредит", "rate": 19, "min_amount": 500_000, "max_amount": 50_000_000,
                   "min_term": 12, "max_term": 60, "payment_types": ["annuity", "differentiated", "annuity_grace"], "max_grace": 3},
    "transport": {"name": "Кредит на транспорт", "rate": 19, "min_amount": 300_000, "max_amount": 50_000_000,
                  "min_term": 12, "max_term": 60, "payment_types": ["annuity", "differentiated"]},
    "real_estate": {"name": "Кредит под залог недвижимости", "rate": 18, "min_amount": 1_000_000, "max_amount": 150_000_000,
                    "min_term": 12, "max_term": 120, "payment_types": ["annuity", "differentiated"]},
    "development": {"name": "Кредит на развитие", "rate": 21, "min_amount": 500_000, "max_amount": 30_000_000,
                    "min_term": 12, "max_term": 60, "payment_types": ["annuity", "differentiated", "annuity_grace"], "max_grace": 3},
    "gov_contract": {"name": "Кредит под контракт", "rate": 20, "min_amount": 300_000, "max_amount": 30_000_000,
                     "min_term": 1, "max_term": 24, "payment_types": ["interest_only"]},
    "refinance": {"name": "Рефинансирование", "rate": 19, "min_amount": 500_000, "max_amount": 150_000_000,
                  "min_term": 12, "max_term": 120, "payment_types": ["annuity", "differentiated"]},
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

# Обороты по счетам в нашем банке: средний в месяц за 12 мес и изменение среднего за 3 мес к нему
DWH: dict[str, dict] = {
    ALFA: {"monthly_turnover": 6_000_000, "change_3m": 0.08},
    SMIRNOV: {"monthly_turnover": 1_800_000, "change_3m": 0.0},
    TECHNO: {"monthly_turnover": 800_000, "change_3m": 0.0},
    VECTOR: {"monthly_turnover": 300_000, "change_3m": -0.2},
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
    BUSINESS_TOO_YOUNG = "business_too_young"
    HIGH_RISK_SCORE = "high_risk_score"
    HIGH_DEBT_LOAD = "high_debt_load"
    LOW_TURNOVER = "low_turnover"
    UNRELIABLE_DATA = "unreliable_data"
    NEED_BANK_STATEMENT = "need_bank_statement"


REASON_TEXT: dict[ReasonCode, str] = {
    ReasonCode.COMPANY_LIQUIDATED: "По данным ЕГРЮЛ компания находится в стадии ликвидации, поэтому кредит на неё оформить нельзя.",
    ReasonCode.OVERDUE_CURRENT: "По данным кредитной истории сейчас есть непогашенная просрочка.",
    ReasonCode.BUSINESS_TOO_YOUNG: f"Бизнесу меньше {STOP_BUSINESS_AGE_MONTHS} месяцев — истории оборотов недостаточно.",
    ReasonCode.HIGH_RISK_SCORE: f"Балл скоринга ниже {HIGH_RISK_SCORE} — зона высокого риска.",
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
    payment_type: Optional[PaymentType] = Field(None, description="По умолчанию — первый тип платежа продукта")
    grace_months: int = Field(0, ge=0, description="Месяцев отсрочки для annuity_grace")
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
    payment_type: PaymentType
    grace_months: int
    monthly_payment: int
    pti: float


class Factor(Schema):
    id: str
    title: str
    value: str
    points: int
    explanation: str


class StopFactor(Schema):
    code: ReasonCode
    text: str


class Scoring(Schema):
    """Поля score…calculated_at совпадают с типом Scoring фронта, остальные — расчёт PTI."""

    score: int
    base: int = BASE_SCORE
    zone: Literal["high_risk", "manual", "auto"]
    factors: list[Factor]
    stop_factors: list[StopFactor]
    calculated_at: datetime
    confirmed_turnover: int
    debt_service_capacity: int
    current_monthly_payments: int
    new_monthly_payment: int
    pti: float


class Decision(Schema):
    status: Status
    reason_code: Optional[ReasonCode] = None
    rate: float
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
    payment_type: PaymentType
    grace_months: int
    status: Status
    reason_code: Optional[ReasonCode] = None
    reason_text: Optional[str] = None
    scoring: Optional[Scoring] = None
    offers: list[Offer] = []
    checks: list[Check] = []
    documents: list[DocumentIn] = []


# ---------------------------------------------------------------------------
# Математика: график платежей (как front/src/domain/finance.ts)
# ---------------------------------------------------------------------------


def schedule(amount: float, term: int, rate: float, payment_type: str, grace: int = 0) -> list[float]:
    """Платежи по месяцам. Месячная ставка = годовая / 12 / 100, последний платёж закрывает остаток."""
    r = rate / 12 / 100

    def annuity(principal: float, months: int) -> float:
        return principal * r / (1 - (1 + r) ** -months) if r else principal / months

    grace = grace if payment_type == "annuity_grace" else 0
    level = annuity(amount, term) if payment_type == "annuity" else annuity(amount, term - grace)
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


def calc_pti(current_payments: float, new_payment: float, turnover: float) -> float:
    capacity = turnover * TURNOVER_TO_CASHFLOW
    if capacity <= 0:
        return math.inf
    return (current_payments + new_payment) / capacity


def rate_for(product: dict, score: int) -> float:
    """Ставка решения: базовая ставка продукта, при балле >= 800 — на 1 п.п. ниже."""
    return product["rate"] - 1 if score >= GOOD_SCORE else product["rate"]


def resolve_product(product: str) -> tuple[str, dict]:
    if product in PRODUCTS:
        return product, PRODUCTS[product]
    for pid, p in PRODUCTS.items():
        if p["name"].lower() == product.strip().lower():
            return pid, p
    raise HTTPException(422, f"Неизвестный продукт: {product}")


# ---------------------------------------------------------------------------
# Форматирование (как front/src/utils/format.ts)
# ---------------------------------------------------------------------------


def rub(n: float) -> str:
    return f"{round(n):,}".replace(",", " ") + " ₽"


def pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def plural(n: int, forms: tuple[str, str, str]) -> str:
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def business_age(months: int) -> str:
    y, m = divmod(months, 12)
    parts = [f"{y} {plural(y, ('год', 'года', 'лет'))}" if y else "", f"{m} {plural(m, ('месяц', 'месяца', 'месяцев'))}" if m else ""]
    return " ".join(p for p in parts if p) or "меньше месяца"


# ---------------------------------------------------------------------------
# Пайплайн
# ---------------------------------------------------------------------------


class Terms(Schema):
    amount: int
    term: int
    payment_type: PaymentType
    grace_months: int = 0


def gatekeeper(inn: str, checks: list[Check]) -> list[StopFactor]:
    """Стоп-факторы ЕГРЮЛ и БКИ. Пустой список — фильтры пройдены."""
    egrul, bki = FNS_EGRUL[inn], BKI[inn]
    stops: list[StopFactor] = []
    if egrul["status"] == "LIQUIDATING":
        stops.append(StopFactor(code=ReasonCode.COMPANY_LIQUIDATED, text="Компания ликвидируется по данным ЕГРЮЛ"))
    if egrul["age_months"] < STOP_BUSINESS_AGE_MONTHS:
        stops.append(StopFactor(code=ReasonCode.BUSINESS_TOO_YOUNG, text=f"Бизнесу меньше {STOP_BUSINESS_AGE_MONTHS} месяцев"))
    checks.append(Check(stage="gatekeeper", name="ЕГРЮЛ", passed=not stops,
                        details=f"Статус: {egrul['status']}, работает {business_age(egrul['age_months'])}"))
    if bki["overdue_current"]:
        stops.append(StopFactor(code=ReasonCode.OVERDUE_CURRENT, text="Текущая просрочка по данным БКИ"))
    checks.append(Check(stage="gatekeeper", name="БКИ", passed=not bki["overdue_current"],
                        details="Текущая просрочка" if bki["overdue_current"] else "Текущих просрочек нет"))
    return stops


def confirmed_turnover(inn: str, statement_uploaded: bool) -> int:
    turnover = DWH[inn]["monthly_turnover"]
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


def scorecard(inn: str, terms: Terms, payment: float, turnover: int) -> list[Factor]:
    """Балльная модель (как front/src/mocks/scoring.ts): факторы с баллами к базе 500."""
    egrul, bki = FNS_EGRUL[inn], BKI[inn]
    avg12 = turnover
    avg3 = turnover * (1 + DWH[inn]["change_3m"])
    revenue = turnover * 12

    age = egrul["age_months"]
    age_points = -80 if age < 12 else 0 if age <= 36 else 60

    pay_ratio = payment / avg3 if avg3 > 0 else math.inf
    pay_points = 120 if pay_ratio <= 0.2 else 40 if pay_ratio <= 0.35 else -60 if pay_ratio <= 0.5 else -150

    debt_ratio = (bki["total_debt"] + terms.amount) / revenue if revenue > 0 else math.inf
    debt_points = 100 if debt_ratio <= 0.3 else 0 if debt_ratio <= 0.6 else -100 if debt_ratio <= 1 else -200

    overdue = bki["overdue_closed_12m"]
    if overdue:
        history = Factor(id="credit_history", title="Кредитная история", value=f"закрытых просрочек: {overdue}",
                         points=max(-160, -80 * overdue),
                         explanation=f"За последние 12 месяцев были просрочки ({overdue}), сейчас они закрыты.")
    elif bki["loans"] or bki["total_debt"]:
        history = Factor(id="credit_history", title="Кредитная история", value="без просрочек", points=80,
                         explanation="Кредиты обслуживаются без просрочек.")
    else:
        history = Factor(id="credit_history", title="Кредитная история", value="нет кредитов", points=0,
                         explanation="Кредитов не было — оценить платёжную дисциплину нельзя.")

    change = avg3 / avg12 - 1 if avg12 > 0 else 0
    dyn_points = 50 if change >= 0.1 else 0 if change >= -0.1 else -60 if change >= -0.25 else -120

    amount_ratio = terms.amount / revenue if revenue > 0 else math.inf
    amount_points = 50 if amount_ratio <= 0.25 else 0 if amount_ratio <= 0.5 else -80

    return [
        Factor(id="age", title="Срок работы бизнеса", value=business_age(age), points=age_points,
               explanation=f"Бизнес работает {business_age(age)}."),
        Factor(id="payment_to_turnover", title="Платёж / средний оборот за 3 мес", value=pct(pay_ratio), points=pay_points,
               explanation=f"Новый платёж {rub(payment)} ({PAYMENT_TYPE_LABEL[terms.payment_type]}) составит "
                           f"{pct(pay_ratio)} среднемесячного оборота за 3 месяца."),
        Factor(id="debt_load", title="Долговая нагрузка", value=pct(debt_ratio), points=debt_points,
               explanation=f"Действующие кредиты ({rub(bki['total_debt'])}) и новый ({rub(terms.amount)}) "
                           f"вместе составят {pct(debt_ratio)} годовой выручки."),
        history,
        Factor(id="turnover_dynamics", title="Динамика оборотов", value=f"{'+' if change > 0 else ''}{pct(change)}",
               points=dyn_points, explanation=f"Средний оборот за 3 месяца к среднему за год: {'+' if change > 0 else ''}{pct(change)}."),
        Factor(id="amount_to_revenue", title="Сумма кредита / выручка за 12 мес", value=pct(amount_ratio), points=amount_points,
               explanation=f"Запрошенная сумма — {pct(amount_ratio)} годовой выручки."),
    ]


def brain(inn: str, terms: Terms, product: dict, turnover: int, stops: list[StopFactor], checks: list[Check]) -> tuple[Scoring, float]:
    """Балл по запрошенным условиям и ставке продукта, затем PTI по ставке решения. Возвращает скоринг и ставку."""
    base_payment = load_payment(terms.amount, terms.term, product["rate"], terms.payment_type, terms.grace_months)
    factors = scorecard(inn, terms, base_payment, turnover)
    score = min(1000, max(0, BASE_SCORE + sum(f.points for f in factors)))
    rate = rate_for(product, score)

    current = BKI[inn]["monthly_payments"]
    payment = load_payment(terms.amount, terms.term, rate, terms.payment_type, terms.grace_months)
    pti = calc_pti(current, payment, turnover)
    # PTI — критерий решения, а не слагаемое балла: показываем его рядом с факторами с нулём баллов
    factors.append(Factor(
        id="pti", title="PTI (критерий решения)", value=f"{pti:.2f}", points=0,
        explanation=f"({rub(current)} текущих платежей + {rub(payment)} новый) / ({rub(turnover)} × {TURNOVER_TO_CASHFLOW:g}). "
                    f"Меньше {PTI_APPROVE:g} — одобрение, до {PTI_DECLINE:g} — встречное предложение, выше — отказ.",
    ))
    zone = "high_risk" if score < HIGH_RISK_SCORE else "manual" if score < AUTO_SCORE else "auto"
    checks.append(Check(stage="brain", name="Скоринг", passed=score >= HIGH_RISK_SCORE,
                        details=f"{score} баллов{', ставка −1 п.п.' if rate < product['rate'] else ''}"))
    checks.append(Check(stage="brain", name="PTI", passed=pti < PTI_APPROVE, details=f"PTI = {pti:.3f}"))
    scoring = Scoring(
        score=score, zone=zone, factors=factors, stop_factors=stops, calculated_at=now(),
        confirmed_turnover=turnover,
        debt_service_capacity=round(turnover * TURNOVER_TO_CASHFLOW),
        current_monthly_payments=current,
        new_monthly_payment=round(payment),
        pti=round(pti, 4),
    )
    return scoring, rate


def make_offer(offer_id: str, title: str, terms: Terms, rate: float, current: int, turnover: int) -> Offer:
    payment = load_payment(terms.amount, terms.term, rate, terms.payment_type, terms.grace_months)
    return Offer(
        id=offer_id, title=title, amount=terms.amount, term=terms.term, rate=rate,
        payment_type=terms.payment_type, grace_months=terms.grace_months,
        monthly_payment=round(payment), pti=round(calc_pti(current, payment, turnover), 4),
    )


def fits(terms: Terms, rate: float, current: int, turnover: int) -> bool:
    payment = load_payment(terms.amount, terms.term, rate, terms.payment_type, terms.grace_months)
    return calc_pti(current, payment, turnover) < PTI_APPROVE


def fit_amount(max_payment: float, terms: Terms, rate: float, current: int, turnover: int) -> int:
    """Максимальная сумма (кратная AMOUNT_STEP) на этих условиях, при которой PTI строго < PTI_APPROVE."""
    amount = int(max_amount_for_payment(max_payment, terms.term, rate, terms.payment_type, terms.grace_months) // AMOUNT_STEP * AMOUNT_STEP)
    while amount > 0 and not fits(terms.model_copy(update={"amount": amount}), rate, current, turnover):
        amount -= AMOUNT_STEP
    return amount


def solver(terms: Terms, product: dict, rate: float, current: int, turnover: int) -> list[Offer]:
    """Подбирает условия в рамках продукта (тип платежа сохраняется), при которых PTI < PTI_APPROVE."""
    max_term = product["max_term"]
    max_payment = PTI_APPROVE * turnover * TURNOVER_TO_CASHFLOW - current
    if max_payment <= 0:
        return []

    offers: list[Offer] = []

    # Вариант 1: та же сумма, срок больше
    for t in TERM_GRID:
        longer = terms.model_copy(update={"term": t})
        if terms.term < t <= max_term and fits(longer, rate, current, turnover):
            offers.append(make_offer("extend_term", "Увеличение срока", longer, rate, current, turnover))
            break

    # Вариант 2: тот же срок, сумма меньше
    reduced = fit_amount(max_payment, terms, rate, current, turnover)
    if reduced >= product["min_amount"]:
        offers.append(make_offer("reduce_amount", "Снижение суммы", terms.model_copy(update={"amount": reduced}), rate, current, turnover))

    # Вариант 3: одного срока не хватило — максимальный срок продукта и максимально возможная сумма
    if not any(o.id == "extend_term" for o in offers) and terms.term < max_term:
        longest = terms.model_copy(update={"term": max_term})
        combo = min(fit_amount(max_payment, longest, rate, current, turnover), terms.amount)
        if combo > reduced and combo >= product["min_amount"]:
            offers.append(make_offer("max_term", "Увеличение срока и снижение суммы",
                                     longest.model_copy(update={"amount": combo}), rate, current, turnover))

    return offers


def run_pipeline(inn: str, terms: Terms, product: dict, statement_uploaded: bool) -> Decision:
    checks: list[Check] = []
    if inn not in FNS_EGRUL:
        checks.append(Check(stage="gatekeeper", name="ЕГРЮЛ", passed=False, details="ИНН не найден"))
        return Decision(status=Status.REJECTED, reason_code=ReasonCode.UNRELIABLE_DATA, rate=product["rate"], checks=checks)

    # 1. Gatekeeper
    stops = gatekeeper(inn, checks)

    # 2. Quality Check (если стоп-факторов нет — по ним решение уже понятно)
    turnover = confirmed_turnover(inn, statement_uploaded)
    need_info = None if stops else quality_check(terms.amount, turnover, statement_uploaded, checks)

    # 3. Brain — считаем всегда, чтобы сотрудник видел балл и по отказам
    scoring, rate = brain(inn, terms, product, turnover, stops, checks)

    def done(status: Status, reason: Optional[ReasonCode] = None, offers: Optional[list[Offer]] = None) -> Decision:
        return Decision(status=status, reason_code=reason, rate=rate, scoring=scoring, offers=offers or [], checks=checks)

    # 4. Solver
    if stops:
        return done(Status.REJECTED, stops[0].code)
    if need_info:
        return done(Status.NEED_INFO, need_info)
    if scoring.score < HIGH_RISK_SCORE:
        return done(Status.REJECTED, ReasonCode.HIGH_RISK_SCORE)
    if scoring.pti < PTI_APPROVE:
        return done(Status.APPROVED)
    if scoring.pti >= PTI_DECLINE:
        return done(Status.REJECTED, ReasonCode.HIGH_DEBT_LOAD)

    offers = solver(terms, product, rate, scoring.current_monthly_payments, turnover)
    if not offers:
        checks.append(Check(stage="solver", name="Контр-оффер", passed=False, details=f"Нет условий с PTI < {PTI_APPROVE:g}"))
        return done(Status.REJECTED, ReasonCode.LOW_TURNOVER)
    checks.append(Check(stage="solver", name="Контр-оффер", passed=True, details=f"Вариантов: {len(offers)}"))
    return done(Status.COUNTER_OFFER, offers=offers)


# ---------------------------------------------------------------------------
# In-memory хранилище заявок
# ---------------------------------------------------------------------------

APPLICATIONS: dict[str, Application] = {}


def now() -> datetime:
    return datetime.now(timezone.utc)


def has_statement(app_: Application) -> bool:
    return any(d.doc_type == "bank_statement" for d in app_.documents)


def rescore(app_: Application) -> Application:
    terms = Terms(amount=app_.amount, term=app_.term, payment_type=app_.payment_type, grace_months=app_.grace_months)
    decision = run_pipeline(app_.inn, terms, PRODUCTS[app_.product_id], has_statement(app_))
    app_.status = decision.status
    app_.reason_code = decision.reason_code
    app_.reason_text = REASON_TEXT.get(decision.reason_code) if decision.reason_code else None
    app_.rate = decision.rate
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

app = FastAPI(title="Кредитный конвейер МСБ", version="0.2.0")

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
    egrul, bki, dwh = FNS_EGRUL[inn], BKI[inn], DWH[inn]
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
        "statement": {"monthlyTurnover": dwh["monthly_turnover"], "change3m": dwh["change_3m"]},
    }


@app.get("/api/profiles")
def list_profiles():
    return [profile(inn) for inn in FNS_EGRUL]


@app.get("/api/profiles/{inn}")
def get_profile(inn: str):
    if inn not in FNS_EGRUL:
        raise HTTPException(404, "Компания не найдена")
    return profile(inn)


@app.post("/api/applications", response_model=Application, status_code=201)
def create_application(body: ApplicationIn):
    product_id, product = resolve_product(body.product)
    if not product["min_amount"] <= body.amount <= product["max_amount"]:
        raise HTTPException(422, f"Сумма для «{product['name']}»: от {rub(product['min_amount'])} до {rub(product['max_amount'])}")
    if not product["min_term"] <= body.term <= product["max_term"]:
        raise HTTPException(422, f"Срок для «{product['name']}»: от {product['min_term']} до {product['max_term']} мес.")
    payment_type = body.payment_type or product["payment_types"][0]
    if payment_type not in product["payment_types"]:
        raise HTTPException(422, f"Тип платежа «{PAYMENT_TYPE_LABEL[payment_type]}» недоступен для «{product['name']}»")
    grace = body.grace_months if payment_type == "annuity_grace" else 0
    if payment_type == "annuity_grace" and not 1 <= grace <= min(product.get("max_grace", 0), body.term - 1):
        raise HTTPException(422, f"Отсрочка — от 1 до {product.get('max_grace', 0)} мес. и меньше срока")

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
        payment_type=payment_type,
        grace_months=grace,
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
