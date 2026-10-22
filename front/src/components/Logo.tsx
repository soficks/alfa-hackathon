import { Link } from 'react-router-dom';

export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 52" width={size} height={(size * 52) / 48} aria-hidden="true">
      <rect x="0" y="16" width="20" height="35" rx="6" fill="#EF3124" />
      <rect x="25" y="0" width="21" height="40" rx="6" fill="#EF3124" />
    </svg>
  );
}

/**
 * Знак логотипа — кнопка сворачивания сайдбара.
 * При наведении и фокусе плавно превращается в стрелку: ← в развёрнутом, → в свёрнутом.
 */
export function LogoToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Развернуть меню' : 'Свернуть меню';
  return (
    <button type="button" className={`logo-toggle${collapsed ? ' is-collapsed' : ''}`} onClick={onToggle} aria-label={label} aria-expanded={!collapsed} title={label}>
      <svg viewBox="0 0 48 52" width="34" height="37" aria-hidden="true">
        <g className="logo-toggle__bars">
          <rect x="0" y="16" width="20" height="35" rx="6" fill="#EF3124" />
          <rect x="25" y="0" width="21" height="40" rx="6" fill="#EF3124" />
        </g>
        <g className="logo-toggle__arrow">
          <rect x="2" y="4" width="44" height="44" rx="12" fill="#EF3124" />
          <path d="M28 15 17 26l11 11" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </button>
  );
}

export function LogoText({ to }: { to: string }) {
  return (
    <Link to={to} className="logo__text" aria-label="Бизнес кабинет — на главную">
      Бизнес
      <br />
      кабинет
    </Link>
  );
}
