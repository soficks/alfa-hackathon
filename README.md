# alfa-hackathon
решение кейса умный кабинет предпринимателя

## Запуск

- `backend/` — FastAPI + SQLite: хранит заявки, документы, решения и историю, считает скоринг (см. `backend/README.md`).
- `front/` — кабинет предпринимателя и сотрудника на React (см. `front/README.md`).

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
cd front && npm install && npm run dev        # http://localhost:5173
```
