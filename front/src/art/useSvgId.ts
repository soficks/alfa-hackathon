import { useId } from 'react';

/** Уникальный префикс для id градиентов: несколько одинаковых SVG на странице не конфликтуют. */
export function useSvgId() {
  return 's' + useId().replace(/[^a-zA-Z0-9]/g, '');
}
