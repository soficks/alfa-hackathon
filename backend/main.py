"""
Бизнес-кабинет МСБ — бэкенд (FastAPI + SQLite).

Сервер хранит весь жизненный цикл кредитной заявки: черновики, документы клиента, запросы документов,
статусы, решения сотрудников, ответы клиентов, переписку и историю. Всё адресуется одним applicationId.

Модули:
    sources.py    — справочники и моки внешних источников (ЕГРЮЛ, БКИ, DWH/выписка)
    engine.py     — версионируемые правила: график платежей, скоринг 0–1000, PTI, решение
    db.py         — схема SQLite и репозиторий
    lifecycle.py  — операции над заявкой, авто-проверки, пересчёт скоринга
    seed.py       — демо-данные и тестовые заявки для тестового личного кабинета

Кто делает запрос, сервер узнаёт из заголовка X-User-Id (id пользователя из GET /api/state): это демо-режим
без паролей. Каждый запрос пишется в таблицу api_requests — смотреть: GET /api/requests.

Запуск:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
    Swagger: http://localhost:8000/docs
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

import db as store
import engine
import lifecycle as lc
import seed
import sources as src
from sources import ApiError

log = logging.getLogger("cabinet")

# ---------------------------------------------------------------------------
# Тела запросов (camelCase, как в типах фронта)
# ---------------------------------------------------------------------------


class Schema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def data(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


class FileIn(Schema):
    id: Optional[str] = None
    name: str = Field(..., examples=["Выписка за сентябрь 2026.pdf"])
    size: int = Field(0, ge=0)
    doc_type: str = Field("bank_statement", examples=["bank_statement"])
    added_at: Optional[str] = None
    demo: Optional[bool] = None


class DocumentsIn(Schema):
    files: list[FileIn] = Field(..., min_length=1)
    request_id: Optional[str] = Field(None, description="Закрыть конкретный запрос документов")


class RequestItemIn(Schema):
    doc_type: str
    comment: str = ""


class DocumentRequestIn(Schema):
    items: list[RequestItemIn] = Field(..., min_length=1)
    due_at: str = Field(..., description="Срок ответа клиента, ISO-дата")


class TermsIn(Schema):
    amount: int
    term: int
    rate: float
    payment_type: Literal["annuity", "differentiated", "interest_only", "annuity_grace"]
    grace_months: Optional[int] = None


class DecisionIn(Schema):
    type: Literal["approve", "counter_offer", "reject"]
    terms: Optional[TermsIn] = Field(None, description="Для approve и counter_offer")
    valid_days: int = Field(src.OFFER_VALID_DAYS, ge=1, le=30)
    reason_code: Optional[str] = Field(None, description="Для reject: код из справочника причин отказа")
    justification: str = Field(..., description="Внутреннее обоснование, не меньше 20 символов")
    client_message: str = ""


class ClientResponseIn(Schema):
    action: Literal["accept", "decline", "sign", "issue", "withdraw"]
    offer_id: Optional[str] = Field(None, description="accept: выбрать вариант из decision.offers")
    reason: str = Field("", description="decline: причина")
    account_number: Optional[str] = Field(None, description="issue: счёт для зачисления")


class MessageIn(Schema):
    text: str = Field(..., min_length=1)


class ClientChangesIn(Schema):
    requested: Optional[dict[str, Any]] = Field(None, examples=[{"amount": 1_500_000, "term": 18}])
    financials: Optional[dict[str, Any]] = Field(None, examples=[{"revenue12m": 30_000_000}])


class ScoringPreviewIn(Schema):
    inn: str = Field(..., examples=[src.ALFA])
    amount: int = Field(..., gt=0, examples=[2_000_000])
    term: int = Field(..., gt=0, examples=[24])
    product_id: str = Field("working_capital")
    payment_type: Optional[str] = None
    grace_months: int = 0
    external_statement: bool = False
    model_version: Optional[str] = None


# ---------------------------------------------------------------------------
# Приложение
# ---------------------------------------------------------------------------

QUIET_PATHS = ("/api/revision", "/api/requests", "/api/state", "/docs", "/openapi.json", "/redoc", "/health", "/favicon.ico")
APP_PATH = re.compile(r"^/api/applications/([^/]+)")


def create_app(db_path: Optional[str] = None, *, seed_on_start: bool = True, worker: bool = True) -> FastAPI:
    database = store.Database(db_path)
    stop = threading.Event()

    def checks_worker() -> None:
        """Фоновые авто-проверки: шаги конвейера идут по таймеру и переживают перезагрузку страницы и сервера."""
        while not stop.wait(0.3):
            try:
                lc.tick_all(database)
            except Exception:  # noqa: BLE001 — воркер не должен падать
                log.exception("Ошибка авто-проверок")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if seed_on_start and database.is_empty():
            seed.seed_demo(database)
        thread = threading.Thread(target=checks_worker, name="checks-worker", daemon=True)
        if worker:
            thread.start()
        yield
        stop.set()

    api = FastAPI(title="Бизнес-кабинет МСБ", version="0.3.0", lifespan=lifespan)
    api.state.db = database
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    # ---------- журнал запросов ----------

    @api.middleware("http")
    async def request_log(request: Request, call_next):
        started = time.perf_counter()
        body = (await request.body()).decode("utf-8", "replace")[:4000] if request.method in ("POST", "PUT", "PATCH") else None
        response: Response = await call_next(request)
        path = request.url.path
        if request.method != "OPTIONS" and path.startswith(("/api", "/health")) and not path.startswith(QUIET_PATHS):
            error = None
            if response.status_code >= 400:
                error = getattr(request.state, "error", None)
            m = APP_PATH.match(path)
            try:
                with database.tx() as c:
                    store.log_request(c, lc.iso(lc.now_utc()), request.method, path, request.url.query, response.status_code,
                                      (time.perf_counter() - started) * 1000, request.headers.get("x-user-id"),
                                      m.group(1) if m else None, body, error)
            except Exception:  # noqa: BLE001
                log.exception("Не удалось записать запрос в журнал")
        return response

    @api.exception_handler(ApiError)
    async def on_api_error(request: Request, exc: ApiError):
        request.state.error = exc.detail
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @api.exception_handler(RequestValidationError)
    async def on_validation_error(request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ())[1:])
        detail = f"{where}: {first.get('msg', 'некорректные данные')}" if where else first.get("msg", "Некорректные данные")
        request.state.error = detail
        return JSONResponse({"detail": detail, "errors": jsonable(exc.errors())}, status_code=422)

    def jsonable(errors: list[dict]) -> list[dict]:
        return [{"loc": list(e.get("loc", ())), "msg": e.get("msg"), "type": e.get("type")} for e in errors]

    # ---------- зависимости ----------

    def current_user(x_user_id: Optional[str] = Header(None)) -> dict:
        if not x_user_id:
            raise ApiError(401, "Не указан пользователь (заголовок X-User-Id)")
        with database.tx(write=False) as c:
            user = store.get_user(c, x_user_id)
        if not user:
            raise ApiError(401, "Пользователь не найден")
        return user

    def optional_user(x_user_id: Optional[str] = Header(None)) -> Optional[dict]:
        if not x_user_id:
            return None
        with database.tx(write=False) as c:
            return store.get_user(c, x_user_id)

    def load(c, app_id: str) -> dict:
        app = store.load_application(c, app_id)
        if not app:
            raise ApiError(404, f"Заявка № {app_id} не найдена")
        return app

    def check_access(app: dict, user: dict) -> None:
        if user["role"] == "client" and app["ownerUserId"] != user["id"]:
            raise ApiError(403, "Это не ваша заявка")

    def require_employee(user: dict) -> None:
        if user["role"] != "employee":
            raise ApiError(403, "Действие доступно только сотруднику банка")

    def require_assignee(app: dict, user: dict) -> None:
        require_employee(user)
        if app.get("assigneeId") != user["id"]:
            raise ApiError(403, "Сначала возьмите заявку в работу")

    def mutate(app_id: str, user: dict, fn, *, employee: bool = False, assignee: bool = False) -> dict:
        """Загрузить заявку → проверить права → изменить → сохранить, всё в одной транзакции."""
        with database.tx() as c:
            app = load(c, app_id)
            check_access(app, user)
            if assignee:
                require_assignee(app, user)
            elif employee:
                require_employee(user)
            fn(app, lc.actor_of(user), lc.now_utc(), c)
            store.save_application(c, app)
            database.touch()
            return store.load_application(c, app_id)

    # ---------- служебные ----------

    @api.get("/health", tags=["service"])
    def health():
        return {"status": "ok", "revision": database.revision()}

    @api.get("/api/revision", tags=["service"], summary="Счётчик изменений БД (для опроса фронтом)")
    def revision():
        return {"revision": database.revision()}

    @api.get("/api/state", tags=["service"], summary="Все данные кабинета одним ответом")
    def state():
        with database.tx(write=False) as c:
            seeded = c.execute("SELECT value FROM meta WHERE key = 'seeded_at'").fetchone()
            return {
                "revision": database.revision(), "seededAt": seeded["value"] if seeded else lc.iso(lc.now_utc()),
                "users": store.list_users(c), "accounts": store.list_accounts(c), "companies": store.list_companies(c),
                "applications": store.list_applications(c), "wizards": store.all_wizards(c),
            }

    @api.post("/api/reset", status_code=204, tags=["service"], summary="Пересоздать БД с демо-данными")
    def reset():
        seed.seed_demo(database)
        return Response(status_code=204)

    @api.post("/api/clients/{client_id}/test-applications", status_code=201, tags=["service"],
              summary="Добавить тестовому клиенту набор заявок")
    def test_applications(client_id: str, scenarios: Optional[list[str]] = None):
        return {"created": seed.add_test_applications(database, client_id, scenarios), "available": seed.TEST_SCENARIOS}

    @api.get("/api/requests", tags=["service"], summary="Журнал HTTP-запросов к API")
    def requests_log(applicationId: Optional[str] = None, limit: int = 100):
        with database.tx(write=False) as c:
            return store.list_requests(c, applicationId, min(max(limit, 1), 1000))

    # ---------- справочники и внешние источники ----------

    @api.get("/api/products", tags=["reference"])
    def products():
        return list(src.PRODUCTS.values())

    @api.get("/api/rules", tags=["reference"], summary="Версии правил скоринга")
    def rules():
        return [{"version": r.version, **{k: v for k, v in r.__dict__.items() if k != "version"}} for r in engine.RULESETS.values()]

    @api.get("/api/profiles", tags=["reference"], summary="Демо-профили автоматического конвейера")
    def profiles():
        return src.demo_profiles()

    @api.get("/api/registry/{inn}", tags=["sources"], summary="ЕГРЮЛ/ЕГРИП: выписка по ИНН")
    def registry(inn: str):
        with database.tx() as c:
            company = lc.registry_lookup(c, inn)
            database.touch()
            return company

    @api.get("/api/bki/{inn}", tags=["sources"], summary="БКИ: кредитная история")
    def bki(inn: str):
        error = src.check_inn(inn)
        if error:
            raise ApiError(422, error)
        return src.bki_report(inn)

    @api.get("/api/statement/{inn}", tags=["sources"], summary="Выписка по счёту и БКИ для предзаполнения финансов")
    def statement(inn: str):
        error = src.check_inn(inn)
        if error:
            raise ApiError(422, error)
        return src.prefill_financials(inn)

    @api.post("/api/scoring/preview", tags=["sources"], summary="Скоринг и решение без создания заявки")
    def scoring_preview(body: ScoringPreviewIn):
        product = src.PRODUCTS.get(body.product_id)
        if not product:
            raise ApiError(422, f"Неизвестный продукт: {body.product_id}")
        ptype = body.payment_type or product["paymentTypes"][0]
        requested = {"amount": body.amount, "term": body.term, "rate": product["baseRate"], "paymentType": ptype,
                     **({"graceMonths": body.grace_months} if ptype == "annuity_grace" else {})}
        invalid = lc.validate_terms(product, requested)
        if invalid:
            raise ApiError(422, invalid)
        with database.tx() as c:
            company = lc.registry_lookup(c, body.inn)
        ev = engine.evaluate(company=company, financials=src.prefill_financials(body.inn), requested=requested, product=product, documents=[],
                             rules=engine.rules_for(body.model_version), now=lc.now_utc(), external_statement=body.external_statement)
        return ev

    # ---------- мастер заявки ----------

    @api.get("/api/users/{user_id}/wizard", tags=["wizard"])
    def get_wizard(user_id: str):
        with database.tx(write=False) as c:
            return store.get_wizard(c, user_id)

    @api.put("/api/users/{user_id}/wizard", tags=["wizard"], summary="Сохранить шаг мастера; черновик заявки обновляется тоже")
    def put_wizard(user_id: str, wizard: dict[str, Any], user: dict = Depends(current_user)):
        if user["id"] != user_id:
            raise ApiError(403, "Это не ваш мастер заявки")
        at = lc.now_utc()
        with database.tx() as c:
            store.put_wizard(c, user_id, wizard, lc.iso(at))
            app_id = wizard.get("appId")
            app = store.load_application(c, app_id) if app_id else None
            if app and app["status"] == "DRAFT" and app["ownerUserId"] == user_id:
                lc.apply_draft(app, wizard, at)
                store.save_application(c, app)
            database.touch()
        return wizard

    @api.delete("/api/users/{user_id}/wizard", status_code=204, tags=["wizard"])
    def delete_wizard(user_id: str, user: dict = Depends(current_user)):
        if user["id"] != user_id:
            raise ApiError(403, "Это не ваш мастер заявки")
        with database.tx() as c:
            store.delete_wizard(c, user_id)
            database.touch()
        return Response(status_code=204)

    # ---------- заявки: чтение ----------

    @api.get("/api/applications", tags=["applications"], summary="Список заявок (клиент видит только свои)")
    def list_applications(clientId: Optional[str] = None, status: Optional[str] = None, assigneeId: Optional[str] = None,
                          inn: Optional[str] = None, user: Optional[dict] = Depends(optional_user)):
        if user and user["role"] == "client":
            clientId = user["id"]
        with database.tx(write=False) as c:
            return store.list_applications(c, clientId, status, assigneeId, inn)

    @api.get("/api/applications/{app_id}", tags=["applications"])
    def read_application(app_id: str, user: Optional[dict] = Depends(optional_user)):
        with database.tx(write=False) as c:
            app = load(c, app_id)
        if user:
            check_access(app, user)
        return app

    @api.get("/api/applications/{app_id}/record", tags=["applications"], summary="Краткая запись заявки")
    def application_record(app_id: str):
        with database.tx(write=False) as c:
            return lc.record_view(load(c, app_id))

    @api.get("/api/applications/{app_id}/history", tags=["applications"], summary="История заявки (клиент видит только открытые события)")
    def application_history(app_id: str, user: Optional[dict] = Depends(optional_user)):
        with database.tx(write=False) as c:
            app = load(c, app_id)
        role = user["role"] if user else "employee"
        if user:
            check_access(app, user)
        return lc.history_view(app, role)

    @api.get("/api/applications/{app_id}/scoring", tags=["applications"], summary="Все расчёты скоринга по заявке с факторами")
    def application_scoring(app_id: str, user: dict = Depends(current_user)):
        require_employee(user)
        with database.tx(write=False) as c:
            load(c, app_id)
            return store.scoring_snapshots(c, app_id)

    @api.get("/api/applications/{app_id}/external-data", tags=["applications"], summary="Что запросили у ЕГРЮЛ, БКИ и DWH")
    def application_external(app_id: str, user: dict = Depends(current_user)):
        require_employee(user)
        with database.tx(write=False) as c:
            load(c, app_id)
            return store.external_data(c, app_id)

    @api.get("/api/applications/{app_id}/requests", tags=["applications"], summary="HTTP-запросы по этой заявке")
    def application_requests(app_id: str, limit: int = 100):
        with database.tx(write=False) as c:
            return store.list_requests(c, app_id, min(max(limit, 1), 1000))

    # ---------- заявки: создание и изменение ----------

    @api.post("/api/applications", status_code=201, tags=["applications"], summary="Создать черновик заявки")
    def create_application(draft: dict[str, Any], user: dict = Depends(current_user)):
        if user["role"] != "client" or not user.get("companyInn"):
            raise ApiError(403, "Заявку создаёт клиент с привязанной компанией")
        at = lc.now_utc()
        with database.tx() as c:
            company = draft.get("company") or lc.registry_lookup(c, user["companyInn"], at)
            app_id = store.next_application_id(c)
            app = lc.blank_application(app_id, user["id"], company, draft.get("goalId") or "working", at, engine.DEFAULT_MODEL_VERSION)
            lc.apply_draft(app, draft, at)
            lc.with_event(app, at, lc.actor_of(user), "draft_saved", "Черновик сохранён")
            store.save_application(c, app)
            database.touch()
            return store.load_application(c, app_id)

    @api.patch("/api/applications/{app_id}", tags=["applications"],
               summary="Черновик: сохранить шаг. Отправленная заявка: изменить сумму, срок, тип платежа или финансы (пересчёт скоринга)")
    def patch_application(app_id: str, body: dict[str, Any], user: dict = Depends(current_user)):
        if user["role"] != "client":
            raise ApiError(403, "Менять заявку может только клиент")

        def change(app: dict, actor: dict, at, _c) -> None:
            if app["status"] == "DRAFT":
                lc.apply_draft(app, body, at)
            else:
                ClientChangesIn.model_validate(body)
                lc.update_by_client(app, actor, {"requested": body.get("requested"), "financials": body.get("financials")}, at)

        return mutate(app_id, user, change)

    @api.delete("/api/applications/{app_id}", status_code=204, tags=["applications"], summary="Удалить черновик")
    def delete_application(app_id: str, user: dict = Depends(current_user)):
        with database.tx() as c:
            app = load(c, app_id)
            check_access(app, user)
            if app["status"] != "DRAFT" or app["ownerUserId"] != user["id"]:
                raise ApiError(409, "Удалить можно только свой черновик")
            store.delete_application(c, app_id)
            wizard = store.get_wizard(c, user["id"])
            if wizard and wizard.get("appId") == app_id:
                store.delete_wizard(c, user["id"])
            database.touch()
        return Response(status_code=204)

    @api.post("/api/applications/{app_id}/submit", tags=["applications"], summary="Отправить черновик: запускаются авто-проверки")
    def submit_application(app_id: str, user: dict = Depends(current_user)):
        def go(app: dict, actor: dict, at, c) -> None:
            wizard = store.get_wizard(c, user["id"])
            if wizard and wizard.get("appId") == app_id:
                if not wizard.get("companyConfirmed"):
                    raise ApiError(400, "Подтвердите данные компании")
                store.delete_wizard(c, user["id"])
            lc.submit(app, at, actor)

        if user["role"] != "client":
            raise ApiError(403, "Отправляет заявку клиент")
        return mutate(app_id, user, go)

    @api.post("/api/applications/{app_id}/documents", tags=["applications"], summary="Клиент прикрепляет документы")
    def upload_documents(app_id: str, body: DocumentsIn, user: dict = Depends(current_user)):
        if user["role"] != "client":
            raise ApiError(403, "Документы загружает клиент")
        return mutate(app_id, user, lambda app, actor, at, _c: lc.add_documents(app, actor, [f.data() for f in body.files], at, body.request_id))

    @api.post("/api/applications/{app_id}/take", tags=["employee"], summary="Сотрудник берёт заявку в работу")
    def take(app_id: str, user: dict = Depends(current_user)):
        return mutate(app_id, user, lambda app, actor, at, _c: lc.take_to_work(app, actor, at), employee=True)

    @api.post("/api/applications/{app_id}/document-requests", tags=["employee"], summary="Сотрудник запрашивает документы у клиента")
    def request_documents(app_id: str, body: DocumentRequestIn, user: dict = Depends(current_user)):
        try:
            due = lc.parse_iso(body.due_at)
        except ValueError:
            raise ApiError(422, "dueAt: ожидается дата в формате ISO") from None
        return mutate(app_id, user, lambda app, actor, at, _c: lc.request_documents(app, actor, [i.data() for i in body.items], due, at), assignee=True)

    @api.post("/api/applications/{app_id}/decision", tags=["employee"], summary="Решение сотрудника: одобрить, встречное предложение или отказ")
    def decide(app_id: str, body: DecisionIn, user: dict = Depends(current_user)):
        def go(app: dict, actor: dict, at, _c) -> None:
            data = body.data()
            if body.type == "reject":
                lc.reject_application(app, actor, data, at)
            else:
                if not body.terms:
                    raise ApiError(422, "terms: для одобрения и встречного предложения нужны условия")
                lc.make_decision(app, actor, data, at)

        return mutate(app_id, user, go, assignee=True)

    @api.post("/api/applications/{app_id}/client-response", tags=["client"], summary="Ответ клиента: принять, отказаться, подписать, получить деньги, отозвать")
    def client_response(app_id: str, body: ClientResponseIn, user: dict = Depends(current_user)):
        if user["role"] != "client":
            raise ApiError(403, "Отвечает клиент")

        def go(app: dict, actor: dict, at, c) -> None:
            if body.action == "accept":
                lc.accept_offer(app, actor, at, body.offer_id)
            elif body.action == "decline":
                lc.decline_offer(app, actor, body.reason, at)
            elif body.action == "sign":
                lc.sign_documents(app, actor, at)
            elif body.action == "withdraw":
                lc.withdraw(app, actor, at)
            else:
                accounts = [a for a in store.list_accounts(c) if a["companyInn"] == app["company"]["inn"]]
                if not accounts:
                    accounts = [{"number": n} for n in synthetic_accounts(app["company"]["inn"])]
                if not any(a["number"] == body.account_number for a in accounts):
                    raise ApiError(422, "Выберите счёт компании")
                lc.issue(app, actor, body.account_number, at)

        return mutate(app_id, user, go)

    @api.post("/api/applications/{app_id}/messages", tags=["applications"], summary="Сообщение в переписке по заявке")
    def post_message(app_id: str, body: MessageIn, user: dict = Depends(current_user)):
        def go(app: dict, actor: dict, at, _c) -> None:
            if user["role"] == "employee":
                require_assignee(app, user)
            lc.send_message(app, actor, body.text, at)

        return mutate(app_id, user, go)

    @api.post("/api/applications/{app_id}/seen", tags=["applications"], summary="Отметить сообщения и запросы прочитанными")
    def seen(app_id: str, user: dict = Depends(current_user)):
        return mutate(app_id, user, lambda app, actor, at, _c: lc.mark_seen(app, user["role"]))

    @api.post("/api/applications/{app_id}/acknowledge-changes", tags=["employee"], summary="Сотрудник видел изменения клиента")
    def acknowledge(app_id: str, user: dict = Depends(current_user)):
        return mutate(app_id, user, lambda app, actor, at, _c: lc.acknowledge_changes(app, actor, at), assignee=True)

    @api.post("/api/applications/{app_id}/rescore", tags=["employee"], summary="Пересчитать скоринг по версии правил заявки")
    def rescore(app_id: str, user: dict = Depends(current_user)):
        return mutate(app_id, user, lambda app, actor, at, _c: lc.rescore(app, at, actor, "employee"), assignee=True)

    @api.post("/api/applications/{app_id}/clear-new-docs", tags=["employee"], summary="Сбросить отметку «Новые документы»")
    def clear_new_docs(app_id: str, user: dict = Depends(current_user)):
        def go(app: dict, actor: dict, at, _c) -> None:
            if app.get("newDocsForEmployee") and app.get("assigneeId") == user["id"]:
                app["newDocsForEmployee"] = False

        return mutate(app_id, user, go, employee=True)

    return api


def synthetic_accounts(inn: str) -> list[str]:
    """Счета для компаний без счетов в демо-данных — как accountsFor на фронте."""
    tail = inn[-6:].zfill(6)
    return [f"40702810{tail}00012345"[:20], f"40702810{tail}00067890"[:20]]


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
