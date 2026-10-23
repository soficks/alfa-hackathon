/**
 * Точка входа в «серверную» часть: HTTP-клиент FastAPI-бэкенда (backend/main.py).
 * Адрес задаётся VITE_API_URL, по умолчанию http://localhost:8000.
 */
export { api, backendProfileOf, BACKEND_URL } from './server';
export type * from './contracts';
