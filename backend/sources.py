"""
Справочники и «внешние» источники данных: ЕГРЮЛ/ЕГРИП (ФНС), БКИ и выписка по счёту (DWH банка).

Внешних API нет — источники это детерминированные моки, один в один повторяющие
front/src/mocks/{registry,bki,statement,random}.ts: один и тот же ИНН всегда даёт одни и те же данные.
Здесь же живут справочники продуктов, типов документов и причин отказа
(front/src/config/*), чтобы сервер был единственным источником правил.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

M32 = 0xFFFFFFFF
DAY = timedelta(days=1)


class ApiError(Exception):
    """Ошибка предметной области: HTTP-код + текст для пользователя."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def js_round(x: float) -> int:
    """Math.round из JS: .5 округляется вверх."""
    return math.floor(x + 0.5)


# ---------------------------------------------------------------------------
# Детерминированный генератор (random.ts)
# ---------------------------------------------------------------------------


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


def hash_string(s: str) -> int:
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = _imul(h, 16777619)
    return h & M32


def rng(seed: str) -> Callable[[], float]:
    state = [hash_string(seed)]

    def r() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & M32
        t = state[0]
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return r


def pick(r: Callable[[], float], items: list) -> Any:
    return items[math.floor(r() * len(items))]


def between(r: Callable[[], float], lo: float, hi: float) -> float:
    return lo + r() * (hi - lo)


def int_between(r: Callable[[], float], lo: int, hi: int) -> int:
    return math.floor(between(r, lo, hi + 1))


# ---------------------------------------------------------------------------
# Реквизиты (domain/requisites.ts)
# ---------------------------------------------------------------------------

_W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8]
_W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
_W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]


def _weighted(ds: list[int], weights: list[int]) -> int:
    return (sum(w * d for w, d in zip(weights, ds)) % 11) % 10


def is_valid_inn(inn: str) -> bool:
    if re.fullmatch(r"\d{10}", inn):
        d = [int(c) for c in inn]
        return _weighted(d, _W10) == d[9]
    if re.fullmatch(r"\d{12}", inn):
        d = [int(c) for c in inn]
        return _weighted(d, _W11) == d[10] and _weighted(d, _W12) == d[11]
    return False


def is_valid_registration_number(value: str, form: str) -> bool:
    if form == "ИП":
        return bool(re.fullmatch(r"\d{15}", value)) and (int(value[:14]) % 13) % 10 == int(value[14])
    return bool(re.fullmatch(r"\d{13}", value)) and (int(value[:12]) % 11) % 10 == int(value[12])


def check_inn(raw: str) -> Optional[str]:
    """Текст ошибки или None, если ИНН корректен."""
    inn = re.sub(r"\s", "", raw)
    if not inn.isdigit():
        return "ИНН состоит только из цифр"
    if len(inn) not in (10, 12):
        return "ИНН компании — 10 цифр, ИНН ИП — 12 цифр"
    if not is_valid_inn(inn):
        return "Похоже, в ИНН опечатка: не сходится контрольное число"
    return None


def form_by_inn(inn: str) -> str:
    return "ИП" if len(inn) == 12 else "ООО"


def complete_ogrn(prefix12: str) -> str:
    return prefix12 + str((int(prefix12) % 11) % 10)


def complete_ogrnip(prefix14: str) -> str:
    return prefix14 + str((int(prefix14) % 13) % 10)


# ---------------------------------------------------------------------------
# Продукты, цели, документы, причины отказа (front/src/config/*)
# ---------------------------------------------------------------------------

AMOUNT_STEP = 50_000
AUTO_LIMIT = 3_000_000
MIN_BUSINESS_AGE_MONTHS = 12
STOP_BUSINESS_AGE_MONTHS = 6
OFFER_VALID_DAYS = 5
DOC_REQUEST_DAYS = 2
SLA_BUSINESS_DAYS = 1


def _product(id: str, name: str, min_amount: int, max_amount: int, min_term: int, max_term: int, rate: int,
             payment_types: list[str], required: list[str], max_grace: Optional[int] = None) -> dict:
    p = {
        "id": id, "name": name, "minAmount": min_amount, "maxAmount": max_amount, "minTerm": min_term, "maxTerm": max_term,
        "baseRate": rate, "paymentTypes": payment_types, "requiredDocs": required, "autoLimit": AUTO_LIMIT,
    }
    if max_grace:
        p["maxGraceMonths"] = max_grace
    return p


_ANN, _DIFF, _INT, _GRACE = "annuity", "differentiated", "interest_only", "annuity_grace"

PRODUCTS: dict[str, dict] = {p["id"]: p for p in [
    _product("working_capital", "Оборотный кредит", 300_000, 30_000_000, 3, 24, 21, [_ANN, _DIFF], ["bank_statement", "financial_statements"]),
    _product("credit_line", "Кредитная линия", 300_000, 30_000_000, 1, 18, 22, [_INT], ["bank_statement"]),
    _product("investment", "Инвестиционный кредит", 500_000, 50_000_000, 12, 60, 19, [_ANN, _DIFF, _GRACE], ["bank_statement", "supplier_invoice"], 3),
    _product("transport", "Кредит на транспорт", 300_000, 50_000_000, 12, 60, 19, [_ANN, _DIFF], ["bank_statement", "purchase_contract"]),
    _product("real_estate", "Кредит под залог недвижимости", 1_000_000, 150_000_000, 12, 120, 18, [_ANN, _DIFF], ["bank_statement", "estimate"]),
    _product("development", "Кредит на развитие", 500_000, 30_000_000, 12, 60, 21, [_ANN, _DIFF, _GRACE], ["bank_statement", "business_plan"], 3),
    _product("gov_contract", "Кредит под контракт", 300_000, 30_000_000, 1, 24, 20, [_INT], ["bank_statement", "gov_contract"]),
    _product("refinance", "Рефинансирование", 500_000, 150_000_000, 12, 120, 19, [_ANN, _DIFF], ["bank_statement", "debt_certificate"]),
]}

GOAL_PRODUCT = {
    "working": "working_capital", "cash_gap": "credit_line", "equipment": "investment", "transport": "transport",
    "real_estate": "real_estate", "growth": "development", "gov_contract": "gov_contract", "refinance": "refinance",
}

DOC_TYPES: dict[str, dict] = {
    "bank_statement": {"title": "Выписка по расчётному счёту", "short": "Выписка по счёту"},
    "financial_statements": {"title": "Бухгалтерская отчётность", "short": "Отчётность"},
    "supplier_invoice": {"title": "Счёт или спецификация поставщика", "short": "Счёт поставщика"},
    "purchase_contract": {"title": "Счёт или договор купли-продажи", "short": "Договор купли-продажи"},
    "estimate": {"title": "Договор или смета", "short": "Договор или смета"},
    "business_plan": {"title": "Бизнес-план", "short": "Бизнес-план"},
    "gov_contract": {"title": "Государственный контракт", "short": "Госконтракт"},
    "debt_certificate": {"title": "Справка о задолженности", "short": "Справка о долге"},
    "other": {"title": "Другой документ", "short": "Другой документ"},
}

PAYMENT_TYPE_LABEL = {
    "annuity": "Аннуитетный",
    "differentiated": "Дифференцированный",
    "interest_only": "Проценты ежемесячно, долг в конце",
    "annuity_grace": "С отсрочкой",
}

REJECT_REASONS: dict[str, dict] = {r["code"]: r for r in [
    {"code": "high_debt_load", "title": "Высокая долговая нагрузка",
     "clientMessage": "Сейчас у компании уже много действующих кредитов относительно выручки, и новый платёж может оказаться слишком тяжёлым. Попробуйте подать заявку на меньшую сумму или после погашения части текущих кредитов."},
    {"code": "low_turnover", "title": "Недостаточный или нестабильный оборот",
     "clientMessage": "Поступлений на счёт пока недостаточно, чтобы уверенно обслуживать такой кредит. Можно подать заявку на меньшую сумму или на больший срок — платёж станет ниже."},
    {"code": "credit_history", "title": "Просрочки в кредитной истории",
     "clientMessage": "В кредитной истории есть просрочки, поэтому сейчас мы не можем выдать кредит. Когда текущие просрочки будут закрыты, вы сможете подать заявку снова."},
    {"code": "high_risk_score", "title": "Высокий риск по скорингу",
     "clientMessage": "По совокупности показателей — обороты, долговая нагрузка, кредитная история — риск по заявке сейчас слишком высокий. Попробуйте подать заявку на меньшую сумму или позже, когда показатели улучшатся."},
    {"code": "unreliable_data", "title": "Недостоверные данные",
     "clientMessage": "Часть данных в заявке не подтвердилась при проверке. Проверьте реквизиты и документы и подайте заявку заново."},
    {"code": "product_requirements", "title": "Не подходит под требования продукта",
     "clientMessage": "Заявка не подходит под требования выбранного продукта. Посмотрите другие варианты финансирования — возможно, подойдёт другой продукт."},
    {"code": "company_liquidated", "title": "Компания ликвидирована",
     "clientMessage": "По данным ЕГРЮЛ компания ликвидирована, поэтому кредит на неё оформить нельзя."},
    {"code": "overdue_current", "title": "Текущая просрочка в БКИ",
     "clientMessage": "По данным кредитной истории сейчас есть непогашенная просрочка. Когда она будет закрыта, вы сможете подать заявку снова."},
    {"code": "business_too_young", "title": "Бизнесу меньше 6 месяцев",
     "clientMessage": "Компания работает меньше 6 месяцев, а для кредита нужна история оборотов. Подайте заявку, когда бизнесу исполнится полгода."},
    {"code": "other", "title": "Другое",
     "clientMessage": "К сожалению, сейчас мы не можем выдать кредит на этих условиях. Подробности напишет специалист в сообщениях по заявке."},
]}


def reject_reason(code: Optional[str]) -> dict:
    return REJECT_REASONS.get(code or "", REJECT_REASONS["other"])


# ---------------------------------------------------------------------------
# ЕГРЮЛ / ЕГРИП
# ---------------------------------------------------------------------------


def _co(inn: str, ogrn: str, name: str, address: str, age: int, okved: str, okved_name: str, head: str, status: str = "active") -> dict:
    return {"inn": inn, "ogrn": ogrn, "name": name, "address": address, "ageMonths": age,
            "okved": okved, "okvedName": okved_name, "status": status, "head": head}


# Демо-профили конвейера (у каждого свой сценарий решения, см. SCENARIOS)
ALFA, SMIRNOV, TECHNO, VECTOR = "7701111128", "770222222209", "7703333334", "7705555558"

KNOWN_COMPANIES: list[dict] = [
    _co("7704123450", "1227700412345", "ООО «Пример»", "г. Москва, ул. Примерная, д. 1, офис 12", 50, "46.90", "Торговля оптовая неспециализированная", "Иванова Юлия Сергеевна"),
    _co("7701111110", "1237700111110", "ООО «АльфаТех»", "г. Москва, Технопарковая ул., д. 8", 38, "62.01", "Разработка компьютерного программного обеспечения", "Тихонов Максим Андреевич"),
    _co("7715234560", "1217700523457", "ООО «Вектор»", "г. Москва, Заводской пр-д, д. 4", 62, "25.62", "Обработка металлических изделий механическая", "Гусев Алексей Николаевич"),
    _co("500312345614", "320500300123457", "ИП Морозова Елена Викторовна", "Московская обл., г. Химки, ул. Лесная, д. 3", 74, "47.71", "Торговля розничная одеждой", "Морозова Елена Викторовна"),
    _co("772834567838", "324770002345675", "ИП Соколова Ирина Андреевна", "г. Москва, ул. Садовая, д. 21", 26, "56.10", "Деятельность ресторанов и услуги по доставке продуктов питания", "Соколова Ирина Андреевна"),
    _co("7810345670", "1197800345676", "ООО «Север»", "г. Санкт-Петербург, Складская ул., д. 15", 86, "49.41", "Деятельность автомобильного грузового транспорта", "Лебедев Игорь Павлович"),
    _co("5027456784", "1175000456784", "ООО «Маяк»", "Московская обл., г. Люберцы, ул. Строителей, д. 7", 110, "41.20", "Строительство жилых и нежилых зданий", "Захаров Виктор Сергеевич"),
    _co("7732567898", "1207700567898", "ООО «Орион»", "г. Москва, ул. Звёздная, д. 2", 66, "46.69", "Торговля оптовая прочими машинами и оборудованием", "Белов Сергей Игоревич", "liquidated"),
    _co("771956789000", "326770005678903", "ИП Новикова Ольга Петровна", "г. Москва, ул. Новая, д. 10", 4, "96.02", "Предоставление услуг парикмахерскими и салонами красоты", "Новикова Ольга Петровна"),
    _co("5008678904", "1245000678900", "ООО «Гранит»", "Московская обл., г. Долгопрудный, Промышленный пр-д, д. 9", 22, "23.61", "Производство изделий из бетона для строительства", "Савельев Роман Олегович"),
    _co("770367890190", "325770006789013", "ИП Белова Анна Игоревна", "г. Москва, ул. Пятницкая, д. 30", 10, "96.02", "Предоставление услуг парикмахерскими и салонами красоты", "Белова Анна Игоревна"),
    _co("502478901250", "323500307890121", "ИП Кузнецов Дмитрий Олегович", "Московская обл., г. Одинцово, Транспортная ул., д. 5", 34, "45.20", "Техническое обслуживание и ремонт автотранспортных средств", "Кузнецов Дмитрий Олегович"),
    _co("7726789010", "1227700789018", "ООО «Лидер»", "г. Москва, Варшавское ш., д. 47", 48, "73.11", "Деятельность рекламных агентств", "Орлова Мария Дмитриевна"),
    _co("7730890126", "1237700890129", "ООО «Ромашка»", "г. Москва, ул. Полевая, д. 6", 37, "10.71", "Производство хлеба и хлебобулочных изделий", "Фёдорова Наталья Ивановна"),
    _co("7716901231", "1207700901231", "ООО «Полюс»", "г. Москва, Северная ул., д. 11", 70, "33.12", "Ремонт машин и оборудования", "Комаров Павел Евгеньевич"),
    _co("7725123450", "1227700123452", "ООО «Комета»", "г. Москва, Каширское ш., д. 18", 30, "47.19", "Торговля розничная прочая в неспециализированных магазинах", "Яковлев Артём Игоревич"),
    _co(ALFA, "1217700111111", "ООО «Альфа Логистик»", "г. Москва, Складская ул., д. 7", 64, "49.41", "Деятельность автомобильного грузового транспорта", "Кузнецов Игорь Олегович"),
    _co(SMIRNOV, "320770002222227", "ИП Смирнов Андрей Викторович", "г. Москва, ул. Покровка, д. 12", 40, "56.10", "Деятельность ресторанов и услуги по доставке продуктов питания", "Смирнов Андрей Викторович"),
    _co(TECHNO, "1227700333332", "ООО «ТехноСтрой»", "г. Москва, Строительный пр-д, д. 3", 30, "41.20", "Строительство жилых и нежилых зданий", "Белова Марина Игоревна"),
    _co(VECTOR, "1197700555557", "ООО «Вектор Плюс»", "г. Москва, Торговая ул., д. 21", 75, "47.11", "Торговля розничная в неспециализированных магазинах", "Петров Олег Сергеевич", "liquidated"),
]

DEMO_CLIENT_INN = "7704123450"

# DWH банка для демо-профилей: средний оборот в месяц за 12 мес и изменение среднего за 3 мес к нему
DWH: dict[str, dict] = {
    ALFA: {"monthlyTurnover": 6_000_000, "change3m": 0.08},
    SMIRNOV: {"monthlyTurnover": 1_800_000, "change3m": 0.0},
    TECHNO: {"monthlyTurnover": 800_000, "change3m": 0.0},
    VECTOR: {"monthlyTurnover": 300_000, "change3m": -0.2},
}

# Что «распознаётся» в выписке из другого банка: дополнительный оборот в месяц
EXTERNAL_STATEMENTS: dict[str, int] = {TECHNO: 1_200_000}

# Для демо-профилей решение принимает автоматический конвейер (одобрение / встречное / запрос выписки / отказ)
SCENARIOS = {ALFA: "APPROVED", SMIRNOV: "COUNTER_OFFER", TECHNO: "NEED_INFO", VECTOR: "REJECTED"}


def _to_company(r: dict, now: datetime) -> dict:
    """Запись реестра → Company фронта; дата регистрации — ageMonths назад, день детерминирован по ИНН."""
    reg = now - timedelta(days=r["ageMonths"] * 30.44 + int(r["inn"][-2:]) % 20)
    return {
        "inn": r["inn"], "ogrn": r["ogrn"], "form": form_by_inn(r["inn"]), "name": r["name"], "address": r["address"],
        "registeredAt": datetime(reg.year, reg.month, reg.day, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "okved": r["okved"], "okvedName": r["okvedName"], "status": r["status"], "head": r["head"],
    }


_NAMES = ["Альтаир", "Восход", "Горизонт", "Дельта", "Импульс", "Квант", "Меридиан", "Нова", "Ориентир", "Прогресс", "Ресурс", "Статус"]
_SURNAMES = ["Алексеев", "Борисов", "Васильев", "Григорьев", "Дмитриев", "Егоров", "Жуков", "Зайцев"]
_FIRST = ["Андрей", "Борис", "Виктор", "Георгий", "Денис", "Евгений"]
_PATRONYMIC = ["Александрович", "Михайлович", "Сергеевич", "Петрович"]
_OKVEDS = [
    ("46.90", "Торговля оптовая неспециализированная"),
    ("43.39", "Производство прочих отделочных и завершающих работ"),
    ("62.02", "Деятельность консультативная в области компьютерных технологий"),
    ("47.11", "Торговля розничная в неспециализированных магазинах"),
    ("49.41", "Деятельность автомобильного грузового транспорта"),
]
_STREETS = ["Ленина", "Мира", "Гагарина", "Победы"]


def _generate_company(inn: str, now: datetime) -> dict:
    r = rng(inn)
    form = form_by_inn(inn)
    age = int_between(r, 14, 120)
    year = str(now.year - age // 12)[-2:]
    tail = str(int_between(r, 0, 9_999_999)).zfill(7)
    head = f"{pick(r, _SURNAMES)} {pick(r, _FIRST)} {pick(r, _PATRONYMIC)}"
    okved, okved_name = pick(r, _OKVEDS)
    ogrn = complete_ogrnip(f"3{year}{inn[:2]}{tail}00"[:14]) if form == "ИП" else complete_ogrn(f"1{year}{inn[:2]}{tail}")
    record = {
        "inn": inn, "ogrn": ogrn, "name": f"ИП {head}" if form == "ИП" else f"ООО «{pick(r, _NAMES)}»",
        "address": f"г. Москва, ул. {pick(r, _STREETS)}, д. {int_between(r, 1, 80)}",
        "ageMonths": age, "okved": okved, "okvedName": okved_name, "status": "active", "head": head,
    }
    return _to_company(record, now)


def egrul_lookup(inn: str, now: Optional[datetime] = None) -> dict:
    """Выписка из реестра. Невалидный ИНН — 422."""
    inn = re.sub(r"\s", "", inn)
    error = check_inn(inn)
    if error:
        raise ApiError(422, error)
    now = now or datetime.now(timezone.utc)
    known = next((c for c in KNOWN_COMPANIES if c["inn"] == inn), None)
    return _to_company(known, now) if known else _generate_company(inn, now)


# ---------------------------------------------------------------------------
# БКИ
# ---------------------------------------------------------------------------


def _bki(loans: int, debt: int, monthly: int, overdue_now: bool = False, closed: int = 0) -> dict:
    return {"loans": loans, "totalDebt": debt, "monthlyPayments": monthly, "overdueCurrent": overdue_now, "overdueClosed12m": closed}


BKI_KNOWN: dict[str, dict] = {
    "7704123450": _bki(1, 1_800_000, 95_000),
    "7701111110": _bki(3, 8_200_000, 410_000),
    "7715234560": _bki(2, 3_100_000, 160_000),
    "500312345614": _bki(0, 0, 0),
    "772834567838": _bki(2, 2_400_000, 140_000, closed=2),
    "7810345670": _bki(2, 6_500_000, 300_000, closed=1),
    "5027456784": _bki(1, 2_000_000, 90_000),
    "7732567898": _bki(2, 5_000_000, 240_000, True, 3),
    "771956789000": _bki(0, 0, 0),
    "5008678904": _bki(2, 4_500_000, 230_000, closed=1),
    "770367890190": _bki(0, 0, 0),
    "502478901250": _bki(3, 4_800_000, 260_000, closed=2),
    "7726789010": _bki(1, 1_200_000, 70_000),
    "7730890126": _bki(1, 900_000, 60_000),
    "7716901231": _bki(1, 1_500_000, 80_000),
    "7725123450": _bki(2, 3_200_000, 190_000, True, 1),
    ALFA: _bki(2, 3_300_000, 150_000),
    SMIRNOV: _bki(2, 3_900_000, 180_000),
    TECHNO: _bki(1, 1_100_000, 50_000),
    VECTOR: _bki(1, 2_600_000, 120_000, closed=1),
}


def bki_report(inn: str) -> dict:
    known = BKI_KNOWN.get(inn)
    if known:
        return {"inn": inn, **known}
    r = rng(f"bki:{inn}")
    loans = int_between(r, 0, 3)
    debt = js_round(between(r, 300_000, 3_000_000) * loans / 10_000) * 10_000 if loans else 0
    return {
        "inn": inn, "loans": loans, "totalDebt": debt, "monthlyPayments": js_round(debt / 22 / 1000) * 1000,
        "overdueCurrent": False, "overdueClosed12m": 1 if r() < 0.2 else 0,
    }


# ---------------------------------------------------------------------------
# Выписка по счёту
# ---------------------------------------------------------------------------

STATEMENT_KNOWN: dict[str, tuple[int, float]] = {
    "7704123450": (3_000_000, 0.12), "7701111110": (3_800_000, -0.28), "7715234560": (2_600_000, 0.04),
    "500312345614": (2_200_000, 0.15), "772834567838": (600_000, -0.12), "7810345670": (1_100_000, -0.05),
    "5027456784": (4_200_000, 0.1), "7732567898": (1_500_000, -0.3), "771956789000": (250_000, 0.2),
    "5008678904": (1_900_000, -0.15), "770367890190": (300_000, 0.05), "502478901250": (500_000, -0.2),
    "7726789010": (1_300_000, 0.06), "7730890126": (1_600_000, 0.0), "7716901231": (2_000_000, 0.02),
    "7725123450": (1_400_000, -0.05),
}


def _round1000(n: float) -> int:
    return js_round(n / 1000) * 1000


def analyze_statement(inn: str) -> dict:
    """Поступления по месяцам за 12 мес (от старых к новым) и средние обороты."""
    r = rng(f"statement:{inn}")
    dwh = DWH.get(inn)
    if dwh:
        # DWH банка: средний за 12 мес и за 3 мес совпадают с профилем точно
        avg12, change = dwh["monthlyTurnover"], dwh["change3m"]
        avg3_target = avg12 * (1 + change)
        total = avg12 * 12
        last3_sum = js_round(avg3_target * 3)
        first9 = [js_round((total - last3_sum) / 9 * (1 + between(r, -0.04, 0.04))) for _ in range(9)]
        first9[-1] += total - last3_sum - sum(first9)
    else:
        base, change = STATEMENT_KNOWN.get(inn) or (js_round(between(r, 400_000, 4_000_000)), between(r, -0.15, 0.15))
        first9 = [_round1000(base * (1 + between(r, -0.06, 0.06))) for _ in range(9)]
        k = 1 + change
        avg3_target = (k * sum(first9)) / (12 - 3 * k)
        last3_sum = None
    w = [1 + between(r, -0.03, 0.03), 1 + between(r, -0.03, 0.03)]
    if last3_sum is None:
        m10, m11 = _round1000(avg3_target * w[0]), _round1000(avg3_target * w[1])
        m12 = _round1000(avg3_target * 3 - m10 - m11)
    else:
        m10, m11 = js_round(avg3_target * w[0]), js_round(avg3_target * w[1])
        m12 = last3_sum - m10 - m11
    by_month = [*first9, m10, m11, m12]
    revenue = sum(by_month)
    return {
        "inn": inn, "turnoverByMonth": by_month, "revenue12m": revenue,
        "avgTurnover12m": js_round(revenue / 12), "avgTurnover3m": js_round((m10 + m11 + m12) / 3),
    }


def prefill_financials(inn: str) -> dict:
    """Финансы для мастера: выписка + БКИ (клиент может поправить выручку и долги)."""
    s, b = analyze_statement(inn), bki_report(inn)
    return {
        "revenue12m": s["revenue12m"], "avgTurnover12m": s["avgTurnover12m"], "avgTurnover3m": s["avgTurnover3m"],
        "turnoverByMonth": s["turnoverByMonth"], "existingDebt": b["totalDebt"], "existingMonthlyPayments": b["monthlyPayments"],
        "existingLoans": b["loans"], "overdueCurrent": b["overdueCurrent"], "overdueClosed12m": b["overdueClosed12m"],
    }


def demo_profiles(now: Optional[datetime] = None) -> list[dict]:
    """Профили демо-клиентов: GET /api/profiles (экран входа)."""
    now = now or datetime.now(timezone.utc)
    out = []
    for inn, scenario in SCENARIOS.items():
        company = _to_company(next(c for c in KNOWN_COMPANIES if c["inn"] == inn), now)
        out.append({"inn": inn, "scenario": scenario, "registry": company, "bki": bki_report(inn), "statement": DWH[inn]})
    return out
