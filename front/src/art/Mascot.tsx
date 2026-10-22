import { useSvgId } from './useSvgId';

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-fur`} cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor="#FF6A58" />
        <stop offset="0.55" stopColor="#F02C1F" />
        <stop offset="1" stopColor="#C4140A" />
      </radialGradient>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFE07A" />
        <stop offset="0.55" stopColor="#F7BE1E" />
        <stop offset="1" stopColor="#D99400" />
      </linearGradient>
    </defs>
  );
}

/** Голова кота-маскота, система координат 100×100. */
function Head({ id }: { id: string }) {
  const fur = `url(#${id}-fur)`;
  const gold = `url(#${id}-gold)`;
  return (
    <g>
      <path d="M17 42 L21 11 Q23 5 29 9 L47 25 Z" fill={fur} />
      <path d="M83 42 L79 11 Q77 5 71 9 L53 25 Z" fill={fur} />
      <path d="M24 31 L26 15 L38 25 Z" fill="#FF9A8B" />
      <path d="M76 31 L74 15 L62 25 Z" fill="#FF9A8B" />
      <ellipse cx="50" cy="51" rx="39" ry="33" fill={fur} />
      <ellipse cx="37" cy="31" rx="13" ry="6" fill="#fff" opacity="0.2" />
      <path d="M29 49 q6.5 -8 13 0" stroke="#5B0D07" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d="M58 49 q6.5 -8 13 0" stroke="#5B0D07" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <ellipse cx="26" cy="60" rx="6.5" ry="3.8" fill="#FFA597" opacity="0.85" />
      <ellipse cx="74" cy="60" rx="6.5" ry="3.8" fill="#FFA597" opacity="0.85" />
      <path d="M46.5 55.5 h7 l-3.5 3.4z" fill="#7C140B" />
      <path d="M43.5 60.5 q3.2 4.5 6.5 0 q3.2 4.5 6.5 0" stroke="#5B0D07" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M21 75 Q50 92 79 75 L77 82 Q50 98 23 82 Z" fill={gold} />
      <circle cx="50" cy="87" r="10.5" fill={gold} stroke="#C98700" strokeWidth="1.4" />
      <circle cx="50" cy="87" r="7.4" fill="none" stroke="#E2A300" strokeWidth="1" />
      <path d="M45.8 91.6 L50 81.6 L54.2 91.6 M47.2 88.4 H52.8" stroke="#E3261B" strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function MascotHead({ size = 56, className }: { size?: number; className?: string }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <Defs id={id} />
      <Head id={id} />
    </svg>
  );
}

/** Круглая аватарка помощника в чате. */
export function MascotAvatar({ size = 56 }: { size?: number }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <Defs id={id} />
      <circle cx="50" cy="50" r="50" fill="#FDE9E7" />
      <g transform="translate(9 12) scale(0.82)">
        <Head id={id} />
      </g>
    </svg>
  );
}

/** Кот целиком, машет лапкой — для промо-блока в сайдбаре. */
export function MascotFull({ width = 190, className }: { width?: number; className?: string }) {
  const id = useSvgId();
  const fur = `url(#${id}-fur)`;
  const gold = `url(#${id}-gold)`;
  return (
    <svg viewBox="0 0 150 160" width={width} className={className} aria-hidden="true">
      <Defs id={id} />
      {/* тело */}
      <ellipse cx="64" cy="132" rx="50" ry="36" fill={fur} />
      <ellipse cx="44" cy="148" rx="13" ry="9" fill="#E3261B" />
      <ellipse cx="84" cy="150" rx="13" ry="9" fill="#E3261B" />
      {/* поднятая лапа */}
      <path d="M96 104 Q112 92 116 64" stroke={fur} strokeWidth="20" strokeLinecap="round" fill="none" />
      <ellipse cx="117" cy="56" rx="15" ry="17" fill={fur} />
      <ellipse cx="117" cy="60" rx="6" ry="5" fill="#FF9A8B" />
      <circle cx="110" cy="50" r="2.6" fill="#FF9A8B" />
      <circle cx="117" cy="46.5" r="2.6" fill="#FF9A8B" />
      <circle cx="124" cy="50" r="2.6" fill="#FF9A8B" />
      <g transform="translate(6 6) scale(1.1)">
        <Head id={id} />
      </g>
      {/* большая монета на груди */}
      <circle cx="61" cy="122" r="17" fill={gold} stroke="#C98700" strokeWidth="1.6" />
      <circle cx="61" cy="122" r="12.5" fill="none" stroke="#E2A300" strokeWidth="1.2" />
      <path d="M54.5 129.5 L61 113.5 L67.5 129.5 M56.6 124.4 H65.4" stroke="#E3261B" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
