export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 52" width={size} height={(size * 52) / 48} aria-hidden="true">
      <rect x="0" y="16" width="20" height="35" rx="6" fill="#EF3124" />
      <rect x="25" y="0" width="21" height="40" rx="6" fill="#EF3124" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo">
      <LogoMark />
      {!compact && (
        <span className="logo__text">
          Бизнес
          <br />
          кабинет
        </span>
      )}
    </div>
  );
}
