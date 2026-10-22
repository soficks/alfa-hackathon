/**
 * Точка входа в «серверную» часть. Сейчас — мок поверх localStorage.
 * Для настоящего backend достаточно экспортировать здесь HTTP-реализацию Api.
 */
import { mockApi } from '../mocks/api';

export const api = mockApi;
export { connectBackend, backendProfileOf, isBackendOnline, BACKEND_URL } from '../mocks/backend';
export type * from './contracts';
