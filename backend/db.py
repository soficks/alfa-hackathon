"""
SQLite: схема, подключение и репозиторий заявок.

Заявка хранится в нескольких таблицах (клиент, компания, запрошенные внешние данные, документы клиента,
запросы документов, переписка, история, результаты скоринга), а наружу отдаётся одним агрегатом
в форме типа Application фронта (camelCase) плюс поля сервера: applicationId, clientId, companyInn,
modelVersion, requestedTerms, scoringResult, assignedEmployeeId.
Операции над заявкой (lifecycle.py) работают с этим агрегатом, репозиторий только читает и пишет его.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

DEFAULT_PATH = Path(__file__).parent / "data" / "cabinet.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('client', 'employee')),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  company_inn TEXT, authority TEXT, is_test INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  number TEXT PRIMARY KEY, title TEXT NOT NULL, company_inn TEXT NOT NULL
);

-- Данные о компании, запрошенные в ЕГРЮЛ/ЕГРИП (кэш ответа реестра)
CREATE TABLE IF NOT EXISTS companies (
  inn TEXT PRIMARY KEY, ogrn TEXT NOT NULL, form TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL,
  registered_at TEXT NOT NULL, okved TEXT NOT NULL, okved_name TEXT NOT NULL, status TEXT NOT NULL, head TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  application_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES users(id),
  company_inn TEXT NOT NULL,
  status TEXT NOT NULL,
  goal_id TEXT NOT NULL, subgoal_id TEXT,
  product_id TEXT NOT NULL,
  requested_amount INTEGER NOT NULL, requested_term INTEGER NOT NULL, requested_rate REAL NOT NULL,
  payment_type TEXT NOT NULL, grace_months INTEGER,
  indicative_rate REAL NOT NULL,
  model_version TEXT NOT NULL,
  score INTEGER, pti REAL,
  scoring_json TEXT, recommendation_json TEXT, decision_json TEXT,
  company_json TEXT NOT NULL, financials_json TEXT, consents_json TEXT NOT NULL, contact_person_json TEXT,
  checks_json TEXT NOT NULL DEFAULT '[]', pipeline_json TEXT, issued_json TEXT,
  assigned_employee_id TEXT REFERENCES users(id), assigned_at TEXT, sla_due_at TEXT,
  created_at TEXT NOT NULL, submitted_at TEXT, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  changed_since_review INTEGER, new_docs_for_employee INTEGER, draft_step INTEGER,
  signed_at TEXT, decline_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_app_client ON applications(client_id);
CREATE INDEX IF NOT EXISTS ix_app_status ON applications(status);
CREATE INDEX IF NOT EXISTS ix_app_assignee ON applications(assigned_employee_id);

-- Документы, которые клиент прикрепил сам (метаданные файла)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  position INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, doc_type TEXT NOT NULL,
  added_at TEXT NOT NULL, added_by TEXT NOT NULL, source TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, id)
);

-- Запросы документов от банка (сотрудник или система) и их закрытие
CREATE TABLE IF NOT EXISTS doc_requests (
  id TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  position INTEGER NOT NULL, doc_type TEXT NOT NULL, comment TEXT NOT NULL, due_at TEXT NOT NULL,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, fulfilled_by_doc_id TEXT, fulfilled_at TEXT,
  seen_by_client INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  position INTEGER NOT NULL, author TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
  read_by_client INTEGER NOT NULL, read_by_employee INTEGER NOT NULL,
  PRIMARY KEY (application_id, id)
);

-- История заявки: каждое событие жизненного цикла
CREATE TABLE IF NOT EXISTS history (
  id TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  position INTEGER NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT, type TEXT NOT NULL,
  text TEXT NOT NULL, client_text TEXT, visible_to_client INTEGER NOT NULL,
  PRIMARY KEY (application_id, id)
);
CREATE INDEX IF NOT EXISTS ix_history_app ON history(application_id, position);

-- Что клиент изменил в заявке после отправки (по версиям)
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  version INTEGER NOT NULL, at TEXT NOT NULL, field TEXT NOT NULL, from_value TEXT NOT NULL, to_value TEXT NOT NULL
);

-- Каждый расчёт скоринга: версия правил, балл, PTI и условия, по которым считали
CREATE TABLE IF NOT EXISTS scoring_results (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  position INTEGER NOT NULL, calculated_at TEXT NOT NULL, trigger TEXT NOT NULL, model_version TEXT NOT NULL,
  score INTEGER NOT NULL, pti REAL, zone TEXT NOT NULL, outcome TEXT NOT NULL,
  amount INTEGER NOT NULL, term INTEGER NOT NULL, payment_type TEXT NOT NULL, rate REAL NOT NULL, scoring_json TEXT NOT NULL
);

-- Ответы внешних источников по заявке: ЕГРЮЛ, БКИ, DWH/выписка
CREATE TABLE IF NOT EXISTS external_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  source TEXT NOT NULL, inn TEXT NOT NULL, requested_at TEXT NOT NULL, payload_json TEXT NOT NULL
);

-- Черновик мастера заявки на сервере (шаги, введённые данные)
CREATE TABLE IF NOT EXISTS wizards (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data_json TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Журнал HTTP-запросов к API: чтобы отследить, что делали фронт и сотрудники
CREATE TABLE IF NOT EXISTS api_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, query TEXT,
  status INTEGER NOT NULL, duration_ms REAL NOT NULL, user_id TEXT, application_id TEXT, request_body TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS ix_requests_app ON api_requests(application_id);
"""

TABLES_TO_CLEAR = [
    "api_requests", "external_data", "scoring_results", "changes", "history", "messages", "doc_requests", "documents",
    "applications", "wizards", "accounts", "companies", "users",
]


def dumps(value: Any) -> Optional[str]:
    return None if value is None else json.dumps(value, ensure_ascii=False)


def loads(text: Optional[str]) -> Any:
    return None if text is None else json.loads(text)


class Database:
    """Одно соединение SQLite с глобальной блокировкой: бэкенд-поток проверок и HTTP-запросы не пересекаются."""

    def __init__(self, path: str | os.PathLike | None = None):
        path = str(path or os.environ.get("CABINET_DB") or DEFAULT_PATH)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if path != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        self._dirty = False

    @contextmanager
    def tx(self, write: bool = True) -> Iterator[sqlite3.Connection]:
        """Транзакция. Запись увеличивает revision — по нему фронт понимает, что пора обновить данные."""
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            self._dirty = False
            try:
                yield self.conn
                if write and self._dirty:
                    self.conn.execute(
                        "INSERT INTO meta(key, value) VALUES ('revision', '1') "
                        "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
                self.conn.execute("COMMIT")
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise

    def touch(self) -> None:
        self._dirty = True

    def revision(self) -> int:
        with self.lock:
            row = self.conn.execute("SELECT value FROM meta WHERE key = 'revision'").fetchone()
            return int(row["value"]) if row else 0

    def clear(self) -> None:
        with self.tx() as c:
            for table in TABLES_TO_CLEAR:
                c.execute(f"DELETE FROM {table}")
            c.execute("DELETE FROM meta WHERE key = 'app_seq'")
            self.touch()

    def is_empty(self) -> bool:
        with self.lock:
            return self.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


# ---------------------------------------------------------------------------
# Пользователи, счета, компании
# ---------------------------------------------------------------------------


def user_row(r: sqlite3.Row) -> dict:
    u = {"id": r["id"], "role": r["role"], "firstName": r["first_name"], "lastName": r["last_name"], "position": r["position"],
         "email": r["email"], "phone": r["phone"]}
    if r["company_inn"]:
        u["companyInn"] = r["company_inn"]
    if r["authority"]:
        u["authority"] = r["authority"]
    if r["is_test"]:
        u["isTest"] = True
    return u


def get_user(c: sqlite3.Connection, user_id: str) -> Optional[dict]:
    r = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return user_row(r) if r else None


def list_users(c: sqlite3.Connection) -> list[dict]:
    return [user_row(r) for r in c.execute("SELECT * FROM users ORDER BY role DESC, id")]


def upsert_user(c: sqlite3.Connection, u: dict) -> None:
    c.execute(
        "INSERT OR REPLACE INTO users(id, role, first_name, last_name, position, email, phone, company_inn, authority, is_test) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (u["id"], u["role"], u["firstName"], u["lastName"], u.get("position", ""), u.get("email", ""), u.get("phone", ""),
         u.get("companyInn"), u.get("authority"), 1 if u.get("isTest") else 0))


def list_accounts(c: sqlite3.Connection) -> list[dict]:
    return [{"number": r["number"], "title": r["title"], "companyInn": r["company_inn"]}
            for r in c.execute("SELECT * FROM accounts ORDER BY number")]


def upsert_account(c: sqlite3.Connection, a: dict) -> None:
    c.execute("INSERT OR REPLACE INTO accounts(number, title, company_inn) VALUES (?,?,?)", (a["number"], a["title"], a["companyInn"]))


def company_row(r: sqlite3.Row) -> dict:
    return {"inn": r["inn"], "ogrn": r["ogrn"], "form": r["form"], "name": r["name"], "address": r["address"],
            "registeredAt": r["registered_at"], "okved": r["okved"], "okvedName": r["okved_name"], "status": r["status"], "head": r["head"]}


def get_company(c: sqlite3.Connection, inn: str) -> Optional[dict]:
    r = c.execute("SELECT * FROM companies WHERE inn = ?", (inn,)).fetchone()
    return company_row(r) if r else None


def list_companies(c: sqlite3.Connection) -> list[dict]:
    return [company_row(r) for r in c.execute("SELECT * FROM companies ORDER BY inn")]


def upsert_company(c: sqlite3.Connection, co: dict) -> None:
    c.execute(
        "INSERT OR REPLACE INTO companies(inn, ogrn, form, name, address, registered_at, okved, okved_name, status, head) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (co["inn"], co["ogrn"], co["form"], co["name"], co["address"], co["registeredAt"], co["okved"], co["okvedName"], co["status"], co["head"]))


# ---------------------------------------------------------------------------
# Мастер заявки
# ---------------------------------------------------------------------------


def get_wizard(c: sqlite3.Connection, user_id: str) -> Optional[dict]:
    r = c.execute("SELECT data_json FROM wizards WHERE user_id = ?", (user_id,)).fetchone()
    return loads(r["data_json"]) if r else None


def put_wizard(c: sqlite3.Connection, user_id: str, data: dict, at: str) -> None:
    c.execute("INSERT OR REPLACE INTO wizards(user_id, data_json, updated_at) VALUES (?,?,?)", (user_id, dumps(data), at))


def delete_wizard(c: sqlite3.Connection, user_id: str) -> None:
    c.execute("DELETE FROM wizards WHERE user_id = ?", (user_id,))


def all_wizards(c: sqlite3.Connection) -> dict[str, dict]:
    return {r["user_id"]: loads(r["data_json"]) for r in c.execute("SELECT user_id, data_json FROM wizards")}


# ---------------------------------------------------------------------------
# Заявки
# ---------------------------------------------------------------------------


def next_application_id(c: sqlite3.Connection) -> str:
    row = c.execute("SELECT value FROM meta WHERE key = 'app_seq'").fetchone()
    n = int(row["value"]) + 1 if row else 1042
    c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('app_seq', ?)", (str(n),))
    return f"APP-{n}"


def bump_application_seq(c: sqlite3.Connection, n: int) -> None:
    """Сид задаёт свои номера — следующий свободный номер идёт после них."""
    row = c.execute("SELECT value FROM meta WHERE key = 'app_seq'").fetchone()
    if not row or int(row["value"]) < n:
        c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('app_seq', ?)", (str(n),))


def _bool(v: Any) -> Optional[int]:
    return None if v is None else int(bool(v))


def load_application(c: sqlite3.Connection, app_id: str) -> Optional[dict]:
    r = c.execute("SELECT * FROM applications WHERE application_id = ?", (app_id,)).fetchone()
    return _assemble(c, r) if r else None


def list_applications(c: sqlite3.Connection, client_id: Optional[str] = None, status: Optional[str] = None,
                      assignee_id: Optional[str] = None, inn: Optional[str] = None) -> list[dict]:
    where, args = [], []
    for column, value in (("client_id", client_id), ("status", status), ("assigned_employee_id", assignee_id), ("company_inn", inn)):
        if value is not None:
            where.append(f"{column} = ?")
            args.append(value)
    sql = "SELECT * FROM applications" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY updated_at DESC, application_id DESC"
    return [_assemble(c, r) for r in c.execute(sql, args).fetchall()]


def _children(c: sqlite3.Connection, table: str, app_id: str, order: str = "position") -> list[sqlite3.Row]:
    return c.execute(f"SELECT * FROM {table} WHERE application_id = ? ORDER BY {order}", (app_id,)).fetchall()


def _assemble(c: sqlite3.Connection, r: sqlite3.Row) -> dict:
    app_id = r["application_id"]
    requested: dict = {"amount": r["requested_amount"], "term": r["requested_term"], "rate": r["requested_rate"], "paymentType": r["payment_type"]}
    if r["grace_months"] is not None:
        requested["graceMonths"] = r["grace_months"]
    app: dict = {
        "id": app_id, "applicationId": app_id, "ownerUserId": r["client_id"], "clientId": r["client_id"],
        "company": loads(r["company_json"]), "companyInn": r["company_inn"], "goalId": r["goal_id"], "productId": r["product_id"],
        "requested": requested, "requestedTerms": {"productId": r["product_id"], "amount": r["requested_amount"], "term": r["requested_term"]},
        "indicativeRate": r["indicative_rate"], "modelVersion": r["model_version"], "status": r["status"],
        "createdAt": r["created_at"], "updatedAt": r["updated_at"], "version": r["version"],
        "documents": [{"id": d["id"], "name": d["name"], "size": d["size"], "docType": d["doc_type"], "addedAt": d["added_at"],
                       "addedBy": d["added_by"], "source": d["source"], **({"demo": True} if d["demo"] else {})}
                      for d in _children(c, "documents", app_id)],
        "docRequests": [{"id": q["id"], "docType": q["doc_type"], "comment": q["comment"], "dueAt": q["due_at"], "createdAt": q["created_at"],
                         "createdBy": q["created_by"], "seenByClient": bool(q["seen_by_client"]),
                         **({"fulfilledByDocId": q["fulfilled_by_doc_id"], "fulfilledAt": q["fulfilled_at"]} if q["fulfilled_by_doc_id"] else {})}
                        for q in _children(c, "doc_requests", app_id)],
        "consents": loads(r["consents_json"]), "checks": loads(r["checks_json"]),
        "messages": [{"id": m["id"], "author": m["author"], "authorName": m["author_name"], "text": m["text"], "createdAt": m["created_at"],
                      "readByClient": bool(m["read_by_client"]), "readByEmployee": bool(m["read_by_employee"])}
                     for m in _children(c, "messages", app_id)],
        "history": [{"id": h["id"], "at": h["at"], "actor": h["actor"], "actorName": h["actor_name"], "type": h["type"], "text": h["text"],
                     "visibleToClient": bool(h["visible_to_client"]), **({"clientText": h["client_text"]} if h["client_text"] else {})}
                    for h in _children(c, "history", app_id)],
        "changes": [{"version": h["version"], "at": h["at"], "field": h["field"], "from": h["from_value"], "to": h["to_value"]}
                    for h in _children(c, "changes", app_id, "id")],
        "scoringHistory": [{"id": s["id"], "calculatedAt": s["calculated_at"], "trigger": s["trigger"], "modelVersion": s["model_version"],
                            "score": s["score"], "pti": s["pti"], "zone": s["zone"], "outcome": s["outcome"], "amount": s["amount"],
                            "term": s["term"], "paymentType": s["payment_type"], "rate": s["rate"]}
                           for s in _children(c, "scoring_results", app_id)],
    }
    optional = {
        "subgoalId": r["subgoal_id"], "submittedAt": r["submitted_at"], "financials": loads(r["financials_json"]),
        "contactPerson": loads(r["contact_person_json"]), "scoring": loads(r["scoring_json"]),
        "recommendation": loads(r["recommendation_json"]), "decision": loads(r["decision_json"]),
        "assigneeId": r["assigned_employee_id"], "assignedAt": r["assigned_at"], "slaDueAt": r["sla_due_at"],
        "changedSinceReview": None if r["changed_since_review"] is None else bool(r["changed_since_review"]),
        "newDocsForEmployee": None if r["new_docs_for_employee"] is None else bool(r["new_docs_for_employee"]),
        "draftStep": r["draft_step"], "pipeline": loads(r["pipeline_json"]), "signedAt": r["signed_at"],
        "declineReason": r["decline_reason"], "issued": loads(r["issued_json"]),
    }
    app.update({k: v for k, v in optional.items() if v is not None})
    if r["assigned_employee_id"]:
        app["assignedEmployeeId"] = r["assigned_employee_id"]
    if r["score"] is not None:
        app["scoringResult"] = {"score": r["score"], "pti": r["pti"], "modelVersion": r["model_version"]}
    return app


def save_application(c: sqlite3.Connection, a: dict) -> None:
    """Записать агрегат: строка заявки и все её дочерние таблицы."""
    req = a["requested"]
    s = a.get("scoring")
    c.execute(
        """INSERT INTO applications(application_id, client_id, company_inn, status, goal_id, subgoal_id, product_id,
             requested_amount, requested_term, requested_rate, payment_type, grace_months, indicative_rate, model_version,
             score, pti, scoring_json, recommendation_json, decision_json, company_json, financials_json, consents_json,
             contact_person_json, checks_json, pipeline_json, issued_json, assigned_employee_id, assigned_at, sla_due_at,
             created_at, submitted_at, updated_at, version, changed_since_review, new_docs_for_employee, draft_step, signed_at, decline_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(application_id) DO UPDATE SET
             client_id=excluded.client_id, company_inn=excluded.company_inn, status=excluded.status, goal_id=excluded.goal_id,
             subgoal_id=excluded.subgoal_id, product_id=excluded.product_id, requested_amount=excluded.requested_amount,
             requested_term=excluded.requested_term, requested_rate=excluded.requested_rate, payment_type=excluded.payment_type,
             grace_months=excluded.grace_months, indicative_rate=excluded.indicative_rate, model_version=excluded.model_version,
             score=excluded.score, pti=excluded.pti, scoring_json=excluded.scoring_json, recommendation_json=excluded.recommendation_json,
             decision_json=excluded.decision_json, company_json=excluded.company_json, financials_json=excluded.financials_json,
             consents_json=excluded.consents_json, contact_person_json=excluded.contact_person_json, checks_json=excluded.checks_json,
             pipeline_json=excluded.pipeline_json, issued_json=excluded.issued_json, assigned_employee_id=excluded.assigned_employee_id,
             assigned_at=excluded.assigned_at, sla_due_at=excluded.sla_due_at, created_at=excluded.created_at,
             submitted_at=excluded.submitted_at, updated_at=excluded.updated_at, version=excluded.version,
             changed_since_review=excluded.changed_since_review, new_docs_for_employee=excluded.new_docs_for_employee,
             draft_step=excluded.draft_step, signed_at=excluded.signed_at, decline_reason=excluded.decline_reason""",
        (a["id"], a["ownerUserId"], a["company"]["inn"], a["status"], a["goalId"], a.get("subgoalId"), a["productId"],
         req["amount"], req["term"], req["rate"], req["paymentType"], req.get("graceMonths"), a["indicativeRate"],
         a.get("modelVersion", "demo-v1"), s["score"] if s else None, s.get("pti") if s else None, dumps(s),
         dumps(a.get("recommendation")), dumps(a.get("decision")), dumps(a["company"]), dumps(a.get("financials")),
         dumps(a["consents"]), dumps(a.get("contactPerson")), dumps(a.get("checks", [])), dumps(a.get("pipeline")),
         dumps(a.get("issued")), a.get("assigneeId"), a.get("assignedAt"), a.get("slaDueAt"), a["createdAt"], a.get("submittedAt"),
         a["updatedAt"], a.get("version", 1), _bool(a.get("changedSinceReview")), _bool(a.get("newDocsForEmployee")),
         a.get("draftStep"), a.get("signedAt"), a.get("declineReason")))
    _sync_children(c, a)
    for e in a.pop("externalData", []):
        add_external_data(c, a["id"], e["source"], e["inn"], e["requestedAt"], e["payload"])


def _replace(c: sqlite3.Connection, table: str, app_id: str, columns: str, rows: list[tuple]) -> None:
    c.execute(f"DELETE FROM {table} WHERE application_id = ?", (app_id,))
    marks = ",".join("?" * (columns.count(",") + 1))
    c.executemany(f"INSERT INTO {table}({columns}) VALUES ({marks})", rows)


def _sync_children(c: sqlite3.Connection, a: dict) -> None:
    app_id = a["id"]
    _replace(c, "documents", app_id, "id, application_id, position, name, size, doc_type, added_at, added_by, source, demo",
             [(d["id"], app_id, i, d["name"], d["size"], d["docType"], d["addedAt"], d.get("addedBy", "client"), d.get("source", "submission"), int(bool(d.get("demo"))))
              for i, d in enumerate(a["documents"])])
    _replace(c, "doc_requests", app_id,
             "id, application_id, position, doc_type, comment, due_at, created_at, created_by, fulfilled_by_doc_id, fulfilled_at, seen_by_client",
             [(q["id"], app_id, i, q["docType"], q["comment"], q["dueAt"], q["createdAt"], q["createdBy"], q.get("fulfilledByDocId"),
               q.get("fulfilledAt"), int(bool(q.get("seenByClient")))) for i, q in enumerate(a["docRequests"])])
    _replace(c, "messages", app_id, "id, application_id, position, author, author_name, text, created_at, read_by_client, read_by_employee",
             [(m["id"], app_id, i, m["author"], m["authorName"], m["text"], m["createdAt"], int(m["readByClient"]), int(m["readByEmployee"]))
              for i, m in enumerate(a["messages"])])
    _replace(c, "history", app_id, "id, application_id, position, at, actor, actor_name, type, text, client_text, visible_to_client",
             [(h["id"], app_id, i, h["at"], h["actor"], h.get("actorName"), h["type"], h["text"], h.get("clientText"), int(h.get("visibleToClient", True)))
              for i, h in enumerate(a["history"])])
    _replace(c, "changes", app_id, "application_id, version, at, field, from_value, to_value",
             [(app_id, h["version"], h["at"], h["field"], h["from"], h["to"]) for h in a["changes"]])
    # расчёты скоринга только добавляются: полный снимок факторов старых записей не перезаписываем
    for i, s in enumerate(a.get("scoringHistory", [])):
        c.execute(
            "INSERT OR IGNORE INTO scoring_results(id, application_id, position, calculated_at, trigger, model_version, score, pti, zone, "
            "outcome, amount, term, payment_type, rate, scoring_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (s["id"], app_id, i, s["calculatedAt"], s["trigger"], s["modelVersion"], s["score"], s.get("pti"), s["zone"], s["outcome"],
             s["amount"], s["term"], s["paymentType"], s["rate"], dumps(s.get("scoring") or {})))


def delete_application(c: sqlite3.Connection, app_id: str) -> None:
    c.execute("DELETE FROM applications WHERE application_id = ?", (app_id,))


def scoring_snapshots(c: sqlite3.Connection, app_id: str) -> list[dict]:
    """Полные расчёты скоринга (с факторами) по заявке — для разбора, почему балл менялся."""
    return [{"id": s["id"], "calculatedAt": s["calculated_at"], "trigger": s["trigger"], "modelVersion": s["model_version"],
             "outcome": s["outcome"], "amount": s["amount"], "term": s["term"], "paymentType": s["payment_type"], "rate": s["rate"],
             "scoring": loads(s["scoring_json"])} for s in _children(c, "scoring_results", app_id)]


# ---------------------------------------------------------------------------
# Внешние данные и журнал запросов
# ---------------------------------------------------------------------------


def add_external_data(c: sqlite3.Connection, app_id: str, source: str, inn: str, at: str, payload: dict) -> None:
    c.execute("INSERT INTO external_data(application_id, source, inn, requested_at, payload_json) VALUES (?,?,?,?,?)",
              (app_id, source, inn, at, dumps(payload)))


def external_data(c: sqlite3.Connection, app_id: str) -> list[dict]:
    return [{"source": r["source"], "inn": r["inn"], "requestedAt": r["requested_at"], "payload": loads(r["payload_json"])}
            for r in c.execute("SELECT * FROM external_data WHERE application_id = ? ORDER BY id", (app_id,))]


def log_request(c: sqlite3.Connection, ts: str, method: str, path: str, query: str, status: int, duration_ms: float,
                user_id: Optional[str], app_id: Optional[str], body: Optional[str], error: Optional[str]) -> None:
    c.execute("INSERT INTO api_requests(ts, method, path, query, status, duration_ms, user_id, application_id, request_body, error) "
              "VALUES (?,?,?,?,?,?,?,?,?,?)", (ts, method, path, query or None, status, round(duration_ms, 2), user_id, app_id, body, error))


def list_requests(c: sqlite3.Connection, app_id: Optional[str] = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM api_requests" + (" WHERE application_id = ?" if app_id else "") + " ORDER BY id DESC LIMIT ?"
    args = ([app_id] if app_id else []) + [limit]
    return [{"id": r["id"], "ts": r["ts"], "method": r["method"], "path": r["path"], "query": r["query"], "status": r["status"],
             "durationMs": r["duration_ms"], "userId": r["user_id"], "applicationId": r["application_id"],
             "body": loads(r["request_body"]) if r["request_body"] and r["request_body"].startswith(("{", "[")) else r["request_body"],
             "error": r["error"]} for r in c.execute(sql, args)]
