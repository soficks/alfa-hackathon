# Бэкенд бизнес-кабинета (FastAPI + SQLite)

Сервер хранит весь жизненный цикл кредитной заявки МСБ: черновики, документы клиента, запросы документов, статусы,
решения сотрудников, ответы клиентов, переписку и историю. Всё адресуется одним `applicationId` (`APP-1042`).

```bash
python -m venv venv && venv/Scripts/activate      # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000             # Swagger: http://localhost:8000/docs
pip install -r requirements-dev.txt && pytest      # тесты API
```

БД — `backend/data/cabinet.db` (путь можно задать `CABINET_DB`). При первом запуске она заполняется демо-данными.
Внешних сервисов нет: ЕГРЮЛ, БКИ и выписка — детерминированные моки в `sources.py`.

## Устройство

| Файл | Что внутри |
| --- | --- |
| `main.py` | эндпоинты, права доступа, журнал запросов, фоновый поток авто-проверок |
| `lifecycle.py` | операции над заявкой, стейт-машина, шаги авто-проверок, пересчёт скоринга |
| `engine.py` | версионируемые правила: график платежей, скоринг 0–1000, PTI, решение, встречное предложение |
| `db.py` | схема SQLite и репозиторий (заявка собирается из таблиц в один агрегат) |
| `sources.py` | справочники (продукты, документы, причины отказа) и моки ЕГРЮЛ / БКИ / выписки |
| `seed.py` | демо-данные и тестовые заявки |

Кто делает запрос, сервер узнаёт из заголовка `X-User-Id` (id из `GET /api/state`): демо-режим без паролей.
Клиент видит и меняет только свои заявки, сотрудник — по заявкам, взятым в работу им самим.

## База данных

| Таблица | Назначение |
| --- | --- |
| `users`, `accounts` | клиенты (`CLIENT-001`), сотрудники (`EMP-001`), счета компаний; `is_test` — тестовые личные кабинеты |
| `companies` | **что запросили у ЕГРЮЛ/ЕГРИП** (кэш ответа реестра) |
| `external_data` | **ответы внешних источников по заявке**: ЕГРЮЛ, БКИ, DWH/выписка — что и когда запрашивали |
| `applications` | заявка: `application_id`, `client_id`, `company_inn`, `status`, продукт, запрошенные `amount/term/rate/payment_type`, `score`, `pti`, `model_version`, `decision_json`, `assigned_employee_id`, `updated_at`, а также финансы, согласия, проверки, конвейер |
| `documents` | **что клиент прикрепил сам**: имя, размер, тип, когда и по какому запросу |
| `doc_requests` | запросы документов от сотрудника или системы и их закрытие |
| `messages`, `history`, `changes` | переписка, история событий (с формулировкой для клиента), что клиент изменил по версиям |
| `scoring_results` | каждый расчёт скоринга: версия правил, балл, PTI, условия, полный снимок факторов |
| `wizards` | черновик мастера заявки на сервере (шаг, введённые данные) |
| `api_requests` | журнал HTTP-запросов: метод, путь, статус, время, пользователь, `applicationId`, тело, ошибка |

Запись заявки в формате задачи: `GET /api/applications/{id}/record`

```json
{
  "applicationId": "APP-1042", "clientId": "CLIENT-001", "companyInn": "7704123450", "status": "IN_REVIEW",
  "requestedTerms": {"productId": "working_capital", "amount": 2000000, "term": 24},
  "scoringResult": {"score": 960, "pti": 0.2529, "modelVersion": "demo-v1"},
  "decision": null, "assignedEmployeeId": "EMP-001", "updatedAt": "2026-10-23T10:00:00.000Z"
}
```

Полный агрегат (`GET /api/applications/{id}`) — в форме типа `Application` фронта плюс те же поля записи.

## Эндпоинты по `applicationId`

| Действие | Запрос | Кто |
| --- | --- | --- |
| создать черновик | `POST /api/applications` | клиент |
| прочитать | `GET /api/applications/{id}`, `GET /api/applications?clientId=&status=&assigneeId=` | все |
| изменить | `PATCH /api/applications/{id}` — черновик: шаг мастера; отправленная: `requested` / `financials` с пересчётом скоринга | клиент |
| отправить на проверку | `POST /api/applications/{id}/submit` | клиент |
| приложить документы / закрыть запрос | `POST /api/applications/{id}/documents` `{files, requestId?}` | клиент |
| взять в работу | `POST /api/applications/{id}/take` | сотрудник |
| запросить документы | `POST /api/applications/{id}/document-requests` `{items, dueAt}` | сотрудник заявки |
| решение: одобрить / встречное / отказ | `POST /api/applications/{id}/decision` `{type: approve\|counter_offer\|reject, …}` | сотрудник заявки |
| ответ клиента | `POST /api/applications/{id}/client-response` `{action: accept\|decline\|sign\|issue\|withdraw}` | клиент |
| сообщение | `POST /api/applications/{id}/messages` | клиент, сотрудник заявки |
| история | `GET /api/applications/{id}/history` (клиент видит только открытые события) | все |
| расчёты скоринга с факторами | `GET /api/applications/{id}/scoring` | сотрудник |
| ручной пересчёт | `POST /api/applications/{id}/rescore` | сотрудник заявки |
| что запрашивали у ЕГРЮЛ/БКИ/DWH | `GET /api/applications/{id}/external-data` | сотрудник |
| запросы фронта по заявке | `GET /api/applications/{id}/requests` | все |

Остальное: `GET /api/state` (всё одним ответом), `GET /api/revision` (счётчик изменений для опроса), `PUT /api/users/{id}/wizard`,
`GET /api/registry|bki|statement/{inn}`, `POST /api/scoring/preview` (скоринг без создания заявки), `GET /api/products|rules|profiles`,
`GET /api/requests` (журнал), `POST /api/reset`.

## Пересчёт показателей

Заявка запоминает `modelVersion` при создании (`engine.RULESETS`). Когда клиент меняет сумму, срок, тип платежа или финансы,
загружает документы, или сотрудник жмёт «Пересчитать», сервер считает балл и PTI **по той же версии правил** и дописывает результат:

- строка в `scoring_results` (причина `checks` / `client_changed` / `documents` / `employee`, условия, факторы);
- событие `rescored` в `history` (видно только банку) и событие самого изменения (видно клиенту);
- для заявки в очереди (`IN_QUEUE`) вместо пересчёта запускаются повторные авто-проверки — результат тоже попадает в историю.

Новую версию правил добавляют в `engine.RULESETS`: старые заявки продолжат считаться по своей.

## Как отследить запросы

Каждый запрос к `/api/*` пишется в `api_requests` (кроме опроса `/api/revision` и `/api/state`):

```bash
curl "localhost:8000/api/requests?limit=20"
curl "localhost:8000/api/requests?applicationId=APP-1042"
sqlite3 data/cabinet.db "select ts, method, path, status, user_id from api_requests order by id desc limit 20"
```

## Тестовые данные для тестового личного кабинета

- Демо-данные грузятся при первом запуске: `CLIENT-001` (ООО «Пример»), сотрудники `EMP-001` / `EMP-002`, четыре демо-профиля `CLIENT-101…104`
  с автоматическим исходом (одобрение, встречное предложение, запрос выписки, отказ) и очередь заявок в разных статусах.
- Добавить клиенту заявки: `POST /api/clients/CLIENT-001/test-applications` (сценарии `draft`, `queued`, `need_docs`, `approved_manual`)
  или `python seed.py --client CLIENT-001`.
- Пересоздать БД: `POST /api/reset` или `python seed.py --reset`.
