"""Жизненный цикл заявки через HTTP: создание, проверки, запрос документов, решение, ответ клиента, пересчёт, история."""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import lifecycle as lc  # noqa: E402
import main  # noqa: E402
import sources as src  # noqa: E402

CLIENT, ANNA, PAVEL = "CLIENT-001", "EMP-001", "EMP-002"


@pytest.fixture()
def env():
    app = main.create_app(":memory:", worker=False)
    with TestClient(app) as client:
        yield client, app.state.db


def as_user(user_id: str) -> dict:
    return {"X-User-Id": user_id}


def run_checks(database) -> None:
    """Довести авто-проверки до конца (в бою это делает фоновый поток)."""
    for _ in range(12):
        if not lc.tick_all(database, force=True):
            return


def new_draft(client, inn: str = src.DEMO_CLIENT_INN, amount: int = 2_000_000, user: str = CLIENT) -> dict:
    company = client.get(f"/api/registry/{inn}").json()
    financials = client.get(f"/api/statement/{inn}").json()
    r = client.post("/api/applications", headers=as_user(user), json={
        "goalId": "working", "subgoalId": "goods", "step": 3, "company": company, "financials": financials, "documents": [],
        "requested": {"amount": amount, "term": 24, "rate": 21, "paymentType": "annuity"},
        "consents": {"bki": True, "personalData": True, "authority": True},
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_seed_has_test_cabinet_and_pipeline_scenarios(env):
    client, _ = env
    state = client.get("/api/state").json()
    assert {u["id"] for u in state["users"]} >= {CLIENT, ANNA, PAVEL}
    statuses = {a["company"]["inn"]: a["status"] for a in state["applications"] if a["id"] in ("APP-1036", "APP-1037", "APP-1038", "APP-1039")}
    assert statuses == {src.ALFA: "APPROVED", src.SMIRNOV: "COUNTER_OFFER", src.TECHNO: "NEED_INFO", src.VECTOR: "REJECTED"}
    assert any(a["status"] == "DRAFT" and a["ownerUserId"] == CLIENT for a in state["applications"])


def test_record_has_required_fields(env):
    client, _ = env
    r = client.get("/api/applications/APP-1036/record").json()
    assert set(r) == {"applicationId", "clientId", "companyInn", "status", "requestedTerms", "scoringResult", "decision", "assignedEmployeeId", "updatedAt"}
    assert r["requestedTerms"] == {"productId": "working_capital", "amount": 2_000_000, "term": 24}
    assert r["scoringResult"]["modelVersion"] == "demo-v1" and r["scoringResult"]["pti"] == pytest.approx(0.1679, abs=1e-3)
    assert r["decision"]["type"] == "approve" and r["assignedEmployeeId"] is None


def test_full_lifecycle_by_application_id(env):
    client, database = env
    draft = new_draft(client)
    app_id = draft["id"]
    assert app_id.startswith("APP-") and draft["status"] == "DRAFT" and draft["ownerUserId"] == CLIENT

    sent = client.post(f"/api/applications/{app_id}/submit", headers=as_user(CLIENT)).json()
    assert sent["status"] == "SUBMITTED"
    run_checks(database)
    app = client.get(f"/api/applications/{app_id}").json()
    assert app["status"] == "IN_QUEUE"  # 2 млн < авто-лимита, но не хватает «Бухгалтерской отчётности»
    assert app["modelVersion"] == "demo-v1" and app["scoringHistory"][0]["trigger"] == "checks"

    assert client.post(f"/api/applications/{app_id}/take", headers=as_user(CLIENT)).status_code == 403
    assert client.post(f"/api/applications/{app_id}/take", headers=as_user(ANNA)).json()["status"] == "IN_REVIEW"
    # чужой сотрудник не принимает решение по заявке Анны
    assert client.post(f"/api/applications/{app_id}/decision", headers=as_user(PAVEL),
                       json={"type": "reject", "reasonCode": "other", "justification": "x" * 30, "clientMessage": "нет"}).status_code == 403

    due = "2030-01-01T10:00:00Z"
    req = client.post(f"/api/applications/{app_id}/document-requests", headers=as_user(ANNA),
                      json={"items": [{"docType": "financial_statements", "comment": "Отчётность за 2025"}], "dueAt": due}).json()
    assert req["status"] == "NEED_INFO" and req["docRequests"][0]["fulfilledByDocId"] is None if "fulfilledByDocId" in req["docRequests"][0] else True

    wrong = client.post(f"/api/applications/{app_id}/documents", headers=as_user(CLIENT),
                        json={"files": [{"name": "Договор.pdf", "size": 1000, "docType": "purchase_contract"}], "requestId": req["docRequests"][0]["id"]})
    assert wrong.status_code == 409
    answered = client.post(f"/api/applications/{app_id}/documents", headers=as_user(CLIENT),
                           json={"files": [{"name": "Отчётность.pdf", "size": 52_000, "docType": "financial_statements"}], "requestId": req["docRequests"][0]["id"]}).json()
    assert answered["status"] == "IN_REVIEW" and answered["newDocsForEmployee"] is True
    assert {d["docType"] for d in answered["documents"]} == {"financial_statements"}
    assert answered["scoringHistory"][-1]["trigger"] == "documents"

    decided = client.post(f"/api/applications/{app_id}/decision", headers=as_user(ANNA), json={
        "type": "approve", "terms": {"amount": 2_000_000, "term": 24, "rate": 20, "paymentType": "annuity"}, "validDays": 5,
        "justification": "Обороты подтверждены, просрочек нет, документы в комплекте.", "clientMessage": ""}).json()
    assert decided["status"] == "APPROVED" and decided["decision"]["decidedBy"] == "Анна Смирнова"

    assert client.post(f"/api/applications/{app_id}/client-response", headers=as_user(CLIENT), json={"action": "accept"}).json()["status"] == "SIGNING"
    assert client.post(f"/api/applications/{app_id}/client-response", headers=as_user(CLIENT),
                       json={"action": "issue", "accountNumber": "40702810400000012345"}).status_code == 409  # сначала подпись
    client.post(f"/api/applications/{app_id}/client-response", headers=as_user(CLIENT), json={"action": "sign"})
    issued = client.post(f"/api/applications/{app_id}/client-response", headers=as_user(CLIENT),
                         json={"action": "issue", "accountNumber": "40702810400000012345"}).json()
    assert issued["status"] == "ISSUED" and issued["issued"]["accountNumber"] == "40702810400000012345"

    types = [e["type"] for e in client.get(f"/api/applications/{app_id}/history", headers=as_user(ANNA)).json()]
    for expected in ("draft_saved", "submitted", "auto_started", "scoring", "queued", "taken", "docs_requested", "client_docs", "client_answered", "decision", "client_accepted", "signed", "issued"):
        assert expected in types, expected
    client_view = client.get(f"/api/applications/{app_id}/history", headers=as_user(CLIENT)).json()
    assert all(e["visibleToClient"] for e in client_view) and "scoring" not in [e["type"] for e in client_view]

    # все запросы по заявке попали в журнал
    paths = {(r["method"], r["path"].split(app_id)[-1]) for r in client.get(f"/api/applications/{app_id}/requests").json()}
    assert ("POST", "/submit") in paths and ("POST", "/decision") in paths and ("POST", "/client-response") in paths


def test_client_change_recalculates_by_same_rules_version_and_logs_history(env):
    client, database = env
    app_id = new_draft(client)["id"]
    client.post(f"/api/applications/{app_id}/submit", headers=as_user(CLIENT))
    run_checks(database)
    client.post(f"/api/applications/{app_id}/take", headers=as_user(ANNA))
    before = client.get(f"/api/applications/{app_id}").json()

    changed = client.patch(f"/api/applications/{app_id}", headers=as_user(CLIENT), json={"requested": {"amount": 6_000_000, "term": 18}}).json()
    assert changed["requested"]["amount"] == 6_000_000 and changed["version"] == before["version"] + 1
    assert changed["changedSinceReview"] is True
    last = changed["scoringHistory"][-1]
    assert last["trigger"] == "client_changed" and last["modelVersion"] == before["modelVersion"] == "demo-v1"
    assert last["amount"] == 6_000_000 and last["term"] == 18
    assert changed["scoring"]["score"] != before["scoring"]["score"] or changed["scoring"]["pti"] != before["scoring"]["pti"]
    assert changed["scoringResult"]["pti"] == changed["scoring"]["pti"]
    texts = [e["text"] for e in changed["history"]]
    assert any(t.startswith("Клиент изменил сумму") for t in texts) and any(t.startswith("Скоринг пересчитан") for t in texts)

    unchanged = client.patch(f"/api/applications/{app_id}", headers=as_user(CLIENT), json={"requested": {"amount": 6_000_000}}).json()
    assert unchanged["version"] == changed["version"]  # без изменений — без пересчёта

    # клиент правит финансы: выручка влияет на скоринг
    again = client.patch(f"/api/applications/{app_id}", headers=as_user(CLIENT), json={"financials": {"existingMonthlyPayments": 900_000}}).json()
    assert again["scoringHistory"][-1]["pti"] > last["pti"]
    snapshots = client.get(f"/api/applications/{app_id}/scoring", headers=as_user(ANNA)).json()
    assert len(snapshots) == len(again["scoringHistory"]) and all(s["scoring"]["factors"] for s in snapshots)


def test_changes_in_queue_restart_checks(env):
    client, database = env
    app_id = new_draft(client)["id"]
    client.post(f"/api/applications/{app_id}/submit", headers=as_user(CLIENT))
    run_checks(database)
    r = client.patch(f"/api/applications/{app_id}", headers=as_user(CLIENT), json={"requested": {"amount": 1_000_000}}).json()
    assert r["status"] == "AUTO_CHECKS"
    run_checks(database)
    after = client.get(f"/api/applications/{app_id}").json()
    assert after["status"] == "IN_QUEUE" and after["scoringHistory"][-1]["amount"] == 1_000_000


def test_draft_update_and_delete(env):
    client, _ = env
    app_id = new_draft(client)["id"]
    patched = client.patch(f"/api/applications/{app_id}", headers=as_user(CLIENT), json={"requested": {"amount": 1_500_000, "term": 12, "rate": 21, "paymentType": "annuity"}, "step": 4}).json()
    assert patched["requested"]["amount"] == 1_500_000 and patched["draftStep"] == 4 and patched["status"] == "DRAFT"
    assert client.delete(f"/api/applications/{app_id}", headers=as_user(CLIENT)).status_code == 204
    assert client.get(f"/api/applications/{app_id}").status_code == 404


def test_other_client_cannot_touch_application(env):
    client, _ = env
    assert client.get("/api/applications/APP-1002", headers=as_user("CLIENT-101")).status_code == 403
    assert client.post("/api/applications/APP-1002/documents", headers=as_user("CLIENT-101"),
                       json={"files": [{"name": "a.pdf", "docType": "other"}]}).status_code == 403
    assert client.post("/api/applications/APP-1002/seen").status_code == 401


def test_system_requested_statement_restarts_checks(env):
    client, database = env
    techno = client.get("/api/applications/APP-1038").json()
    assert techno["status"] == "NEED_INFO" and techno["docRequests"][0]["createdBy"] == "Система"
    r = client.post("/api/applications/APP-1038/documents", headers=as_user(techno["ownerUserId"]),
                    json={"files": [{"name": "Выписка другого банка.pdf", "docType": "bank_statement"}], "requestId": techno["docRequests"][0]["id"]}).json()
    assert r["status"] == "AUTO_CHECKS"
    run_checks(database)
    done = client.get("/api/applications/APP-1038").json()
    assert done["status"] in ("APPROVED", "COUNTER_OFFER")  # выписка подтвердила оборот
    assert done["scoring"]["confirmedTurnover"] == 800_000 + src.EXTERNAL_STATEMENTS[src.TECHNO]


def test_counter_offer_accept_chosen_variant(env):
    client, _ = env
    smirnov = client.get("/api/applications/APP-1037").json()
    offers = smirnov["decision"]["offers"]
    assert smirnov["status"] == "COUNTER_OFFER" and len(offers) >= 1
    r = client.post("/api/applications/APP-1037/client-response", headers=as_user(smirnov["ownerUserId"]),
                    json={"action": "accept", "offerId": offers[-1]["id"]}).json()
    assert r["status"] == "SIGNING" and r["decision"]["terms"]["amount"] == offers[-1]["amount"]


def test_wizard_is_stored_on_server_and_syncs_draft(env):
    client, _ = env
    draft = new_draft(client)
    wizard = {"appId": draft["id"], "goalId": "working", "requested": {"amount": 900_000, "term": 12, "rate": 21, "paymentType": "annuity"},
              "step": 2, "company": draft["company"], "companyConfirmed": True, "financials": draft["financials"], "documents": [],
              "consents": {"bki": False, "personalData": False, "authority": False}, "savedAt": None}
    assert client.put(f"/api/users/{CLIENT}/wizard", headers=as_user(CLIENT), json=wizard).status_code == 200
    assert client.put(f"/api/users/{CLIENT}/wizard", headers=as_user("CLIENT-101"), json=wizard).status_code == 403
    assert client.get(f"/api/users/{CLIENT}/wizard").json()["step"] == 2
    synced = client.get(f"/api/applications/{draft['id']}").json()
    assert synced["requested"]["amount"] == 900_000 and synced["draftStep"] == 2
    state = client.get("/api/state").json()
    assert state["wizards"][CLIENT]["appId"] == draft["id"]


def test_test_applications_for_test_cabinet(env):
    client, _ = env
    r = client.post("/api/clients/CLIENT-101/test-applications")
    assert r.status_code == 201
    created = r.json()["created"]
    assert [c["scenario"] for c in created] == ["draft", "queued", "need_docs", "approved_manual"]
    mine = client.get("/api/applications", headers=as_user("CLIENT-101")).json()
    assert {c["applicationId"] for c in created} <= {a["id"] for a in mine}
    assert client.post("/api/clients/EMP-001/test-applications").status_code == 404
    assert client.post("/api/clients/CLIENT-101/test-applications", json=["nope"]).status_code == 422


def test_reset_restores_demo_data_and_numbering(env):
    client, database = env
    new_draft(client)
    assert client.post("/api/reset").status_code == 204
    state = client.get("/api/state").json()
    assert not any(a["id"] == "APP-1042" for a in state["applications"])
    assert new_draft(client)["id"] == "APP-1042"


def test_scoring_preview_and_sources(env):
    client, _ = env
    r = client.post("/api/scoring/preview", json={"inn": src.ALFA, "amount": 2_000_000, "term": 24}).json()
    assert r["outcome"] == "APPROVED" and r["scoring"]["modelVersion"] == "demo-v1"
    assert client.get("/api/registry/7707083894").status_code == 422
    assert client.get("/api/bki/7701111110").json()["loans"] == 3
    assert client.get("/api/revision").json()["revision"] > 0


def test_request_log_records_user_status_and_body(env):
    client, _ = env
    client.post("/api/applications/APP-1002/seen", headers=as_user(CLIENT))
    client.post("/api/applications/APP-1002/take", headers=as_user(CLIENT))
    rows = client.get("/api/requests", params={"applicationId": "APP-1002"}).json()
    by_path = {r["path"]: r for r in rows}
    assert by_path["/api/applications/APP-1002/seen"]["userId"] == CLIENT and by_path["/api/applications/APP-1002/seen"]["status"] == 200
    denied = by_path["/api/applications/APP-1002/take"]
    assert denied["status"] == 403 and "сотруднику" in denied["error"]
