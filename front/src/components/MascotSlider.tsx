import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MascotHead } from '../art/Mascot';

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /**
   * Опорные точки шкалы, расставленные равномерно по треку.
   * Между ними значение интерполируется линейно — так 500 тыс…1 млн
   * занимает столько же места, сколько 1…2 млн (как в макете).
   */
  points: number[];
  formatTick: (value: number) => string;
  formatTip: (value: number) => string;
  ariaLabel: string;
  /** Короткие промежуточные засечки между подписанными */
  minorTicks?: number;
  /** Точки на самом треке в опорных значениях (как у срока) */
  railDots?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function MascotSlider({
  value,
  min,
  max,
  step,
  onChange,
  points,
  formatTick,
  formatTip,
  ariaLabel,
  minorTicks = 0,
  railDots = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const segments = points.length - 1;

  const toPos = (v: number) => {
    const val = clamp(v, points[0], points[segments]);
    let i = 0;
    while (i < segments - 1 && val > points[i + 1]) i++;
    return (i + (val - points[i]) / (points[i + 1] - points[i])) / segments;
  };

  const fromPos = (pos: number) => {
    const scaled = clamp(pos, 0, 1) * segments;
    const i = Math.min(Math.floor(scaled), segments - 1);
    return points[i] + (scaled - i) * (points[i + 1] - points[i]);
  };

  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min, min, max);

  const updateFromPointer = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const next = snap(fromPos((clientX - rect.left) / rect.width));
    if (next !== value) onChange(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromPointer(e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowDown: value - step,
      ArrowRight: value + step,
      ArrowUp: value + step,
      PageDown: value - step * 5,
      PageUp: value + step * 5,
      Home: min,
      End: max,
    };
    if (e.key in keys) {
      e.preventDefault();
      onChange(snap(keys[e.key]));
    }
  };

  const pos = toPos(value) * 100;

  const minor: number[] = [];
  if (minorTicks > 0) {
    for (let s = 0; s < segments; s++) {
      for (let k = 1; k <= minorTicks; k++) minor.push(((s + k / (minorTicks + 1)) / segments) * 100);
    }
  }

  return (
    <div className={`mslider${dragging ? ' is-dragging' : ''}`}>
      <div
        className="mslider__track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging && updateFromPointer(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="mslider__rail" />
        <div className="mslider__fill" style={{ width: `${pos}%` }} />
        {railDots &&
          points.slice(1, -1).map((p) => (
            <span
              key={p}
              className={`mslider__dot${p < value ? ' is-active' : ''}`}
              style={{ left: `${toPos(p) * 100}%` }}
            />
          ))}
        <div
          className="mslider__thumb"
          style={{ left: `${pos}%` }}
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={formatTip(value)}
          onKeyDown={onKeyDown}
        >
          <span className="mslider__tip">{formatTip(value)}</span>
          <MascotHead size={54} className="mslider__cat" />
        </div>
      </div>

      <div className="mslider__scale" aria-hidden="true">
        {minor.map((left) => (
          <span key={left} className="mslider__tick mslider__tick--minor" style={{ left: `${left}%` }} />
        ))}
        {points.map((p, i) => (
          <span
            key={p}
            className={`mslider__tick${i === 0 ? ' is-first' : ''}${i === segments ? ' is-last' : ''}`}
            style={{ left: `${(i / segments) * 100}%` }}
          >
            <span className="mslider__label">{formatTick(p)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
