import { useSvgId } from './useSvgId';

/**
 * Плавная лента: верхний край — кривая, нижний — та же кривая со сдвигом.
 * Один сплошной красный градиент, без светлых вставок и перекручиваний.
 */
export function ribbonPath(top: [number, number][], thickness: number, taper = 0.75) {
  // top: точки P0, C1, C2, P1, C3, C4, P2 (две кубические кривые)
  const [p0, c1, c2, p1, c3, c4, p2] = top;
  const mid = thickness * taper;
  const shift = ([x, y]: [number, number], t: number) => `${x} ${y + t}`;
  return [
    `M${p0[0]} ${p0[1]}`,
    `C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p1[0]} ${p1[1]}`,
    `C${c3[0]} ${c3[1]} ${c4[0]} ${c4[1]} ${p2[0]} ${p2[1]}`,
    `L${shift(p2, thickness)}`,
    `C${shift(c4, mid)} ${shift(c3, mid)} ${shift(p1, mid)}`,
    `C${shift(c2, mid)} ${shift(c1, thickness)} ${shift(p0, thickness)}`,
    'Z',
  ].join(' ');
}

export function RibbonGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor="#C7160C" />
      <stop offset="0.45" stopColor="#EE3326" />
      <stop offset="0.75" stopColor="#E0281B" />
      <stop offset="1" stopColor="#B8120A" />
    </linearGradient>
  );
}

const WAVE: [number, number][] = [
  [-20, 236],
  [130, 236],
  [190, 96],
  [310, 112],
  [430, 128],
  [480, 196],
  [620, 60],
];

/** Декоративная лента для заголовков страниц. */
export function Ribbon({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 600 300" className={className} aria-hidden="true" preserveAspectRatio="xMaxYMin meet">
      <defs>
        <RibbonGradient id={id} />
      </defs>
      <path d={ribbonPath(WAVE, 46)} fill={`url(#${id})`} />
    </svg>
  );
}

/** Две ленты разной глубины для промо-панели входа. */
export function HeroRibbons({ className }: { className?: string }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 640 440" className={className} aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <defs>
        <RibbonGradient id={`${id}-a`} />
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A70E06" />
          <stop offset="1" stopColor="#C9180D" />
        </linearGradient>
      </defs>
      <path
        d={ribbonPath([[-40, 420], [120, 400], [200, 260], [330, 270], [460, 280], [520, 190], [680, 150]], 70)}
        fill={`url(#${id}-b)`}
        opacity="0.75"
      />
      <path
        d={ribbonPath([[-40, 330], [110, 330], [190, 200], [320, 214], [450, 228], [500, 120], [680, 70]], 84)}
        fill={`url(#${id}-a)`}
      />
    </svg>
  );
}
