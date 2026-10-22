import type { Illustration } from '../config/products';
import { RibbonGradient, ribbonPath } from './Ribbon';
import { useSvgId } from './useSvgId';

/* Изометрическая проекция: a — вправо-вниз, b — влево-вниз, c — вверх. */
const C = Math.cos(Math.PI / 6);
const S = 0.5;
type P3 = [number, number, number];
type Origin = [number, number];

const proj = (o: Origin, [a, b, c]: P3) => [o[0] + (a - b) * C, o[1] + (a + b) * S - c] as const;
const pts = (o: Origin, list: P3[]) => list.map((p) => proj(o, p).map((v) => v.toFixed(1)).join(',')).join(' ');

interface Palette {
  top: string;
  left: string;
  right: string;
  stroke: string;
}

const WHITE: Palette = { top: '#FFFFFF', left: '#F2EFED', right: '#DDD7D3', stroke: '#CFC8C3' };
const RED: Palette = { top: '#FF6355', left: '#EF3124', right: '#C41A10', stroke: '#B3150B' };

function IsoBox({ o, a, b, w, d, h, p }: { o: Origin; a: number; b: number; w: number; d: number; h: number; p: Palette }) {
  return (
    <g stroke={p.stroke} strokeWidth="0.8" strokeLinejoin="round">
      <polygon points={pts(o, [[a, b + d, 0], [a + w, b + d, 0], [a + w, b + d, h], [a, b + d, h]])} fill={p.left} />
      <polygon points={pts(o, [[a + w, b, 0], [a + w, b + d, 0], [a + w, b + d, h], [a + w, b, h]])} fill={p.right} />
      <polygon points={pts(o, [[a, b, h], [a + w, b, h], [a + w, b + d, h], [a, b + d, h]])} fill={p.top} />
    </g>
  );
}

function Coins({ x, y, n, rx = 24, ry = 10, h = 6, id }: { x: number; y: number; n: number; rx?: number; ry?: number; h?: number; id: string }) {
  const top = y - n * h;
  return (
    <g>
      <path d={`M${x - rx} ${y} A${rx} ${ry} 0 0 0 ${x + rx} ${y} V${top} H${x - rx} Z`} fill={`url(#${id}-silver)`} stroke="#A7ABB2" strokeWidth="0.8" />
      {Array.from({ length: n - 1 }, (_, i) => (
        <path key={i} d={`M${x - rx} ${y - (i + 1) * h} A${rx} ${ry} 0 0 0 ${x + rx} ${y - (i + 1) * h}`} fill="none" stroke="#B7BBC2" strokeWidth="0.8" />
      ))}
      <ellipse cx={x} cy={top} rx={rx} ry={ry} fill="#F5F6F8" stroke="#B2B6BD" strokeWidth="0.8" />
      <ellipse cx={x} cy={top} rx={rx * 0.68} ry={ry * 0.68} fill="none" stroke="#D3D6DB" strokeWidth="1" />
    </g>
  );
}

function gearPath(teeth: number, outer: number, inner: number) {
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const corners = [
      [inner, a - step * 0.32],
      [outer, a - step * 0.18],
      [outer, a + step * 0.18],
      [inner, a + step * 0.32],
    ];
    corners.forEach(([r, t], j) => {
      d += `${i === 0 && j === 0 ? 'M' : 'L'}${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)} `;
    });
  }
  return d + 'Z';
}

type Wave = [number, number][];

function BackRibbon({ id, wave }: { id: string; wave: Wave }) {
  return <path d={ribbonPath(wave, 34)} fill={`url(#${id}-ribbon)`} />;
}

function Working({ id }: { id: string }) {
  const o: Origin = [150, 96];
  return (
    <>
      <BackRibbon id={id} wave={[[-20, 150], [60, 150], [120, 40], [210, 52], [300, 64], [340, 120], [440, 96]]} />
      <IsoBox o={o} a={0} b={0} w={70} d={70} h={70} p={WHITE} />
      <polygon points={pts(o, [[30, 0, 70], [40, 0, 70], [40, 70, 70], [30, 70, 70]])} fill="#EDE8E4" />
      <IsoBox o={o} a={0} b={80} w={50} d={50} h={46} p={WHITE} />
      <polygon points={pts(o, [[20, 80, 46], [29, 80, 46], [29, 130, 46], [20, 130, 46]])} fill="#EDE8E4" />
      <Coins id={id} x={250} y={196} n={8} />
      <Coins id={id} x={302} y={184} n={6} />
      <Coins id={id} x={338} y={210} n={4} />
      <Coins id={id} x={282} y={232} n={3} />
    </>
  );
}

function Equipment({ id }: { id: string }) {
  const o: Origin = [196, 70];
  const [lx, ly] = proj(o, [0, 80, 78]);
  const [rx, ry] = proj(o, [116, 80, 78]);
  return (
    <>
      <BackRibbon id={id} wave={[[-20, 110], [70, 100], [110, 196], [210, 190], [310, 184], [340, 96], [440, 74]]} />
      <IsoBox o={o} a={0} b={0} w={116} d={80} h={78} p={WHITE} />
      <g transform={`matrix(${C} ${S} 0 1 ${lx} ${ly})`}>
        {Array.from({ length: 5 }, (_, i) => (
          <rect key={i} x={14 + i * 13} y={24} width={6} height={32} rx={3} fill="#D8D2CD" />
        ))}
        <circle cx={96} cy={22} r={4} fill="#EF3124" />
        <rect x={86} y={34} width={20} height={6} rx={3} fill="#D8D2CD" />
      </g>
      <g transform={`matrix(${C} ${-S} 0 1 ${rx} ${ry})`}>
        <g transform="translate(40 40)">
          <path d={gearPath(10, 30, 23)} fill="#F4F1EE" stroke="#BDB5AF" strokeWidth="1" />
          <circle r="16" fill="#E9E4E0" stroke="#C8C0BA" />
          <circle r="7" fill="#CFC7C1" />
        </g>
      </g>
      <IsoBox o={o} a={0} b={-30} w={36} d={22} h={18} p={WHITE} />
    </>
  );
}

function Growth({ id }: { id: string }) {
  const o: Origin = [196, 118];
  const bars: { h: number; p: Palette }[] = [
    { h: 46, p: WHITE },
    { h: 78, p: WHITE },
    { h: 108, p: RED },
    { h: 136, p: WHITE },
  ];
  return (
    <>
      <BackRibbon id={id} wave={[[-20, 196], [80, 196], [120, 70], [210, 80], [300, 90], [330, 30], [440, 20]]} />
      {bars.map((bar, i) => (
        <IsoBox key={i} o={o} a={i * 30} b={60 - i * 30} w={26} d={26} h={bar.h} p={bar.p} />
      ))}
      <IsoBox o={o} a={-6} b={104} w={24} d={24} h={24} p={WHITE} />
      <IsoBox o={o} a={120} b={22} w={20} d={20} h={20} p={RED} />
    </>
  );
}

export function GoalIllustration({ goal, className }: { goal: Illustration; className?: string }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 420 260" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <RibbonGradient id={`${id}-ribbon`} />
        <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#C9CCD2" />
          <stop offset="0.45" stopColor="#F3F4F6" />
          <stop offset="1" stopColor="#B4B8BF" />
        </linearGradient>
      </defs>
      {/* Уменьшаем сцену к центру и опускаем ниже, чтобы компактная карточка не срезала верх */}
      <g transform="translate(210 146) scale(0.8) translate(-210 -130)">
        {goal === 'working' && <Working id={id} />}
        {goal === 'equipment' && <Equipment id={id} />}
        {goal === 'growth' && <Growth id={id} />}
      </g>
    </svg>
  );
}
